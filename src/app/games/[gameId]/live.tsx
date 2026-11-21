import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { db } from '@/db/client';
import {
  TEAM_EVENT_TYPES,
  addEvent,
  addRosterEntry,
  deleteGame,
  endPeriod,
  isPeriodEnded,
  resetClock,
  setClock,
  setLastTwoMinutes,
  startClock,
  stopClock,
  substitute,
  toggleMark,
  undoLastEvent,
  deletePracticeGame,
} from '@/db/repo';
import { clockSeconds, clockStamp, clockToDigits, isClockRunning, isClockUsed } from '@/domain/clock';
import { PRACTICE_GAME_ID, practiceStep } from '@/domain/practice';
import { ON_COURT_MAX, clockDigitsLabel, parseClockDigits, periodSeconds } from '@/domain/lineup';
import { layoutPlayerGrid } from '@/domain/playerGrid';
import { RULES, activeEvents, periodLabel } from '@/domain/rules';
import { deriveGameState, describeEvent, type PlayerState, type TeamState } from '@/domain/stats';
import {
  BENCH_FOUL_KINDS,
  PLAYER_FOUL_KINDS,
  type EventType,
  type FoulKind,
  type Side,
} from '@/domain/types';
import { Button, Chip, Row } from '@/ui/components';
import { DEFAULT_FT, EventLogSheet } from '@/ui/EventLogSheet';
import { FoulBoard } from '@/ui/FoulBoard';
import { GameClock } from '@/ui/GameClock';
import { buildRunningScoreHtml } from '@/output/runningScoreHtml';
import { Text } from '@/ui/Text';
import { colors, radius, sideBg, sideColor } from '@/ui/theme';
import { TopSheet } from '@/ui/TopSheet';
import { attempt, useGame } from '@/ui/useGame';
import { DialogHost, showDialog } from '@/ui/dialog';

/** 選手ではなく「チーム」を選んだ状態。チームのTOV・リバウンドと、ベンチのファウル（C・B）を記録する */
const BENCH = 'bench';
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'];
type Selection = { side: Side; rosterId: string };


type ActionCell =
  | { kind: 'event'; type: EventType; label: string; tone: 'made' | 'miss' | 'stat' }
  | { kind: 'foul' }
  | { kind: 'timeout'; side: Side };

const event = (type: EventType, label: string, tone: 'made' | 'miss' | 'stat'): ActionCell => ({
  kind: 'event',
  type,
  label,
  tone,
});

// 上段＝成功、中段＝失敗、下段＝ファウルとチームの記録
const ACTIONS: ActionCell[][] = [
  [
    event('FG2_MADE', '2P ○', 'made'),
    event('FG3_MADE', '3P ○', 'made'),
    event('FT_MADE', 'FT ○', 'made'),
    event('OREB', 'OR', 'stat'),
    event('AST', 'AST', 'stat'),
  ],
  [
    event('FG2_MISS', '2P ×', 'miss'),
    event('FG3_MISS', '3P ×', 'miss'),
    event('FT_MISS', 'FT ×', 'miss'),
    event('DREB', 'DR', 'stat'),
    event('STL', 'STL', 'stat'),
  ],
  [
    { kind: 'foul' },
    event('TOV', 'TOV', 'stat'),
    event('BLK', 'BLK', 'stat'),
    { kind: 'timeout', side: 'A' },
    { kind: 'timeout', side: 'B' },
  ],
];

type ClockGame = Parameters<typeof clockStamp>[0] & Parameters<typeof clockStamp>[2];

/** いまの残り秒（記録に付ける値）。時計を使っていないピリオドでは null */
function stampNow(game: ClockGame, period: number): number | null {
  return clockStamp(game, period, game, Date.now());
}

/** いまの残り時間を、テンキーの初期値にする。時計を使っていなければ空 */
function clockDigitsNow(game: ClockGame, period: number): string {
  return isClockUsed(game, period) ? clockToDigits(clockSeconds(game, period, game, Date.now())) : '';
}

const STATUS_TEXT = { fouledOut: '退場', disqualified: '失格' } as const;

export default function LiveScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { bundle, reload } = useGame(gameId);
  useKeepAwake();
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<Selection | null>(null);
  const [foulSheet, setFoulSheet] = useState<{ kind: FoulKind; ft: number } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [foulsOpen, setFoulsOpen] = useState(false);
  // 試合中の背番号追加（開始時に相手の番号が全員分かっていない場合のため）
  const [adding, setAdding] = useState<{ side: Side; number: string } | null>(null);
  // 交代シート：交代後にコート上にいる選手と、残り時間（テンキーの数字。空なら時刻なし）
  // clockAuto は、残り時間が時計から自動で入った状態（最初のキーで入れ直しになる）
  const [subSheet, setSubSheet] = useState<{ side: Side; court: string[]; clock: string; clockAuto?: boolean } | null>(
    null,
  );
  // ランニングスコア（オフィシャルの記録とのすり合わせ用に、いつでも開ける）
  const [scoreOpen, setScoreOpen] = useState(false);
  // 時計を直すシート（テンキーの数字。null なら閉じている）
  const [clockEdit, setClockEdit] = useState<string | null>(null);
  // シートを開いた時点の残り時間（見出しに出す）
  const [clockAtOpen, setClockAtOpen] = useState('');
  // 記録できなかった理由など、一時的に知らせる文言（次の操作で消える）
  const [notice, setNotice] = useState<string | null>(null);
  const { height } = useWindowDimensions();

  // 練習用の試合では、次に押す場所を1つずつ案内する
  const practice = gameId === PRACTICE_GAME_ID;
  const [practiceFlags, setPracticeFlags] = useState({ foulSheetUsed: false, foulsViewed: false });
  const step = practice && bundle ? practiceStep(bundle.events, selected?.side ?? null, practiceFlags) : null;

  const period = bundle?.game.currentPeriod ?? 1;
  const state = useMemo(
    () => (bundle ? deriveGameState(bundle.events, bundle.roster, period) : null),
    [bundle, period],
  );
  const scoreHtml = useMemo(() => (bundle && scoreOpen ? buildRunningScoreHtml(bundle) : ''), [bundle, scoreOpen]);
  const marks = useMemo(
    () => (bundle ? bundle.events.filter((e) => e.voidedAt === null && e.type === 'MARK').length : 0),
    [bundle],
  );
  // 残り0になったら止める（時計の部品から呼ばれる）
  const expireClock = useCallback(() => {
    stopClock(db, gameId);
    reload();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [gameId, reload]);
  const recent = useMemo(
    () =>
      bundle
        ? activeEvents(bundle.events)
            .filter((e) => e.type !== 'L2M' && e.type !== 'MARK')
            .slice(-4)
            .reverse()
            .map((e) => describeEvent(e, bundle.roster))
        : [],
    [bundle],
  );

  // 入力できない状態（準備中・終了・照合待ち）なら該当画面へ移る
  const status = bundle?.game.status;
  const ended = bundle ? isPeriodEnded(bundle.events, period) : false;
  useEffect(() => {
    if (status === 'prep') router.replace(`/games/${gameId}/prep`);
    else if (status === 'finished') router.replace(`/games/${gameId}`);
    else if (status === 'live' && ended) router.replace(`/games/${gameId}/check`);
  }, [status, ended, gameId, router]);

  if (!bundle || !state || status !== 'live' || ended) return <View style={styles.screen} />;
  const { game } = bundle;
  const isBench = selected?.rosterId === BENCH;
  // 時計を使っているピリオドでは、記録に残り時間を付ける
  const stamp = () => stampNow(game, period);

  const record = (type: EventType, foul?: { kind: FoulKind; ft: number }) => {
    if (!selected) return;
    const ok = attempt(() =>
      addEvent(db, {
        gameId,
        period,
        side: selected.side,
        rosterId: selected.rosterId === BENCH ? null : selected.rosterId,
        type,
        foulKind: foul?.kind,
        ftAwarded: foul?.ft,
        clockSeconds: stamp(),
      }),
    );
    // 書き込み完了後に画面へ反映する
    reload();
    if (!ok) return;
    void Haptics.impactAsync(
      type === 'FOUL' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
    );
    // 誤入力防止のため、記録のたびに選択を解除する（FTも1本ずつ選び直す）
    setSelected(null);
  };

  const openFoulSheet = () => {
    if (!selected) return;
    const kind: FoulKind = isBench ? 'C' : 'P';
    setFoulSheet({ kind, ft: DEFAULT_FT[kind] });
  };

  const onFoulPress = () => {
    if (!selected) return;
    // ベンチは種類（C/B）の選択が必要。選手はタップでP（FT0）を即記録
    if (isBench) openFoulSheet();
    else record('FOUL', { kind: 'P', ft: 0 });
  };

  const timeout = (side: Side) => {
    const name = (side === 'A' ? game.teamAName : game.teamBName) || `チーム${side}`;
    showDialog(`${name} のタイムアウト`, `記録しますか？（残り${state[side].timeoutsRemaining}回）`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '記録する',
        onPress: () => {
          const ok = attempt(() =>
            addEvent(db, { gameId, period, side, rosterId: null, type: 'TIMEOUT', clockSeconds: stamp() }),
          );
          reload();
          if (ok) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const finishPeriod = () =>
    showDialog(`${periodLabel(period)} を終了`, 'オフィシャルとの照合に進みます。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '終了する',
        onPress: () => {
          endPeriod(db, gameId, period);
          router.replace(`/games/${gameId}/check`);
        },
      },
    ]);

  const undo = () => {
    const undone = undoLastEvent(db, gameId, period);
    reload();
    if (undone) {
      setSelected(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  // 印を付ける。「今の何番だった？」というときに押しておき、あとでログから見直す
  const mark = () => {
    const added = toggleMark(db, { gameId, period, clockSeconds: stamp() });
    reload();
    setNotice(added ? '印を付けました（あとで「ログ」から見直せます）' : '印を外しました');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const toggleClock = () => {
    if (isClockRunning(game, period)) stopClock(db, gameId);
    else startClock(db, gameId);
    reload();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // 合わせるときは数字を入れ直すので、空から始める（いまの時間は見出しに出す）
  const openClockEdit = () => {
    setClockAtOpen(clockDigitsNow(game, period));
    setClockEdit('');
  };

  const confirmClock = () => {
    if (clockEdit === null) return;
    const seconds = parseClockDigits(clockEdit, periodSeconds(period, game));
    if (seconds === undefined || seconds === null) return;
    const ok = attempt(() => setClock(db, gameId, seconds));
    reload();
    if (ok) setClockEdit(null);
  };

  const quitPractice = () => {
    deletePracticeGame(db);
    router.replace('/');
  };

  const skipPractice = () =>
    showDialog('練習をスキップしますか？', '「設定 → 使い方」から、いつでもやり直せます。', [
      { text: '続ける', style: 'cancel' },
      { text: 'スキップする', onPress: quitPractice },
    ]);

  const menu = () =>
    practice
      ? skipPractice()
      : showDialog('メニュー', undefined, [
      { text: '時計を合わせる', onPress: openClockEdit },
      { text: '試合情報・出場登録を編集', onPress: () => router.push(`/games/${gameId}/prep`) },
      {
        text: 'ホームに戻る（試合は続行）',
        onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
      },
      {
        text: 'この試合を削除',
        style: 'destructive',
        onPress: () =>
          showDialog('試合を削除', 'この試合の記録をすべて削除します。元に戻せません。', [
            { text: 'キャンセル', style: 'cancel' },
            {
              text: '削除',
              style: 'destructive',
              onPress: () => {
                deleteGame(db, gameId);
                router.replace('/');
              },
            },
          ]),
      },
          { text: 'キャンセル', style: 'cancel' },
        ]);

  const confirmSub = () => {
    if (!subSheet) return;
    const clockSeconds = parseClockDigits(subSheet.clock, periodSeconds(period, game));
    if (clockSeconds === undefined) return;
    const ok = attempt(() =>
      substitute(db, { gameId, period, side: subSheet.side, onCourt: subSheet.court, clockSeconds }),
    );
    reload();
    if (!ok) return;
    setSubSheet(null);
    setSelected(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // 追加した選手はそのまま選択状態にして、続けてアクションを押せるようにする
  const addNumber = () => {
    if (!adding) return;
    let added: { id: string } | undefined;
    const ok = attempt(() => (added = addRosterEntry(db, gameId, adding.side, { number: adding.number })));
    reload();
    if (!ok || !added) return;
    setSelected({ side: adding.side, rosterId: added.id });
    setAdding(null);
    void Haptics.selectionAsync();
  };

  const select = (side: Side, rosterId: string) => {
    void Haptics.selectionAsync();
    setNotice(null);
    setSelected((cur) => (cur?.side === side && cur.rosterId === rosterId ? null : { side, rosterId }));
  };

  const playerButton = (side: Side, p: PlayerState, compact: boolean) => {
    const out = p.status === 'fouledOut' || p.status === 'disqualified';
    const active = selected?.side === side && selected.rosterId === p.roster.id;
    const warn = p.status === 'warning';
    const tracked = state[side].lineupTracked;
    const benched = tracked && !p.onCourt && !out;
    return (
      <Pressable
        key={p.roster.id}
        accessibilityRole="button"
        accessibilityLabel={`${side} ${p.roster.number}番`}
        accessibilityState={{ selected: active, disabled: out }}
        accessibilityHint={benched ? 'コートに出ていない選手です。長押しで選べます' : undefined}
        disabled={out}
        // 交代を記録しているチームでは、コートに出ていない選手は誤タップで選ばれないようにする。
        // ベンチの選手に記録が必要なとき（失格など）は、長押しで選べる
        onPress={() => {
          if (!benched || active) return select(side, p.roster.id);
          setSelected(null);
          setNotice(`${side} #${p.roster.number} はベンチです（記録するなら長押し）`);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }}
        onLongPress={benched ? () => select(side, p.roster.id) : undefined}
        delayLongPress={350}
        style={[
          styles.cell,
          styles.player,
          warn && styles.cellWarn,
          tracked && p.onCourt && !out && !warn && { borderColor: sideColor(side) },
          benched && styles.cellBenched,
          active && { backgroundColor: sideColor(side), borderColor: sideColor(side), opacity: 1 },
          out && styles.cellOut,
          !active && (step?.target === 'anyPlayer' || (step?.target === 'playerA' && side === 'A')) && styles.hint,
        ]}
      >
        <Text
          num
          style={[
            styles.number,
            benched && styles.numberBenched,
            compact && styles.numberCompact,
            active && { color: colors.primaryText },
            out && { color: colors.disabled },
          ]}
        >
          {p.roster.number}
        </Text>
        {out ? (
          <Text style={[styles.outText, compact && styles.outTextCompact, p.onCourt && { color: colors.danger }]}>
            {STATUS_TEXT[p.status as 'fouledOut' | 'disqualified']}
            {p.onCourt ? '・要交代' : ''}
          </Text>
        ) : (
          p.fouls.total > 0 && (
            <Text
              style={[
                styles.foulCount,
                compact && styles.foulCountCompact,
                warn && { color: colors.warn },
                active && { color: colors.primaryText },
              ]}
            >
              F{p.fouls.total}
            </Text>
          )
        )}
      </Pressable>
    );
  };

  const teamPanel = (side: Side) => {
    const team: TeamState = state[side];
    const benchActive = selected?.side === side && selected.rosterId === BENCH;
    const rows = layoutPlayerGrid(team.players.slice(0, RULES.maxRosterSize), team.lineupTracked);
    const benchFouls = team.coach.C + team.coach.B;
    return (
      <View style={styles.team}>
        <View style={styles.teamInfo}>
          <Text style={styles.infoLabel}>TF</Text>
          <View style={styles.dots} accessible accessibilityLabel={`チームファウル ${team.teamFouls}`}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.foulDot,
                  i < team.teamFouls && { backgroundColor: team.inBonus ? colors.danger : sideColor(side) },
                ]}
              />
            ))}
          </View>
          <Text num style={[styles.infoCount, team.inBonus && { color: colors.danger }]}>
            {team.teamFouls}
          </Text>
          {team.inBonus && <Text style={styles.bonus}>次からFT</Text>}
          <View style={styles.flex} />
          <Text style={styles.infoLabel}>TO 残り{team.timeoutsRemaining}</Text>
        </View>
        {rows.map((row, r) => (
          <View key={r} style={[styles.gridRow, { flex: row.weight }]}>
            {Array.from({ length: row.columns }, (_, c) => {
              const p = row.items[c];
              return p ? playerButton(side, p, row.compact) : <View key={`e${c}`} style={styles.cellEmpty} />;
            })}
          </View>
        ))}
        <View style={styles.teamButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${side} チーム`}
            accessibilityHint="チームのターンオーバー・リバウンドと、ベンチのファウルを記録する"
            accessibilityState={{ selected: benchActive }}
            onPress={() => select(side, BENCH)}
            style={[styles.teamButton, benchActive && { backgroundColor: sideColor(side) }]}
          >
            <Text style={[styles.teamButtonText, benchActive && { color: colors.primaryText }]}>チーム</Text>
            {(team.coach.disqualified || benchFouls > 0) && (
              <Text
                style={[
                  styles.teamButtonSub,
                  team.coach.disqualified && { color: colors.danger },
                  benchActive && { color: colors.primaryText },
                ]}
              >
                {team.coach.disqualified ? 'HC失格' : `ベンチF${benchFouls}`}
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${side} 交代`}
            onPress={() =>
              setSubSheet({
                side,
                court: team.players.filter((p) => p.onCourt).map((p) => p.roster.id),
                // 時計を使っていれば、いまの残り時間を入れておく（直せる）
                clock: clockDigitsNow(game, period),
                clockAuto: true,
              })
            }
            style={[styles.teamButton, { backgroundColor: sideBg(side) }]}
          >
            <Text style={styles.teamButtonText}>交代</Text>
          </Pressable>
          {team.players.length < RULES.maxRosterSize && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${side} 背番号を追加`}
              onPress={() => setAdding({ side, number: '' })}
              style={styles.teamButton}
            >
              <Text style={styles.teamButtonText}>＋番号</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const teamName = (side: Side) => (side === 'A' ? game.teamAName : game.teamBName) || `チーム${side}`;

  const actionButton = (cell: ActionCell) => {
    if (cell.kind === 'foul') {
      return (
        <Pressable
          key="foul"
          accessibilityRole="button"
          accessibilityLabel="ファウル"
          accessibilityHint="長押しで種類とFT数を選択"
          disabled={!selected}
          onPress={onFoulPress}
          onLongPress={openFoulSheet}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.cell,
            styles.foul,
            !selected && styles.actionDisabled,
            step?.target === 'foul' && styles.hint,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.foulText}>FOUL</Text>
          <Text style={styles.foulHint} numberOfLines={1}>
            {isBench ? '種類を選ぶ' : '長押しで種類'}
          </Text>
        </Pressable>
      );
    }
    if (cell.kind === 'timeout') {
      const left = state[cell.side].timeoutsRemaining;
      return (
        <Pressable
          key={`to${cell.side}`}
          accessibilityRole="button"
          accessibilityLabel={`${cell.side} タイムアウト 残り${left}回`}
          disabled={left === 0}
          onPress={() => timeout(cell.side)}
          style={({ pressed }) => [
            styles.cell,
            { backgroundColor: sideBg(cell.side), borderColor: sideBg(cell.side) },
            left === 0 && styles.actionDisabled,
            step?.target === 'timeout' && styles.hint,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.actionText}>TO</Text>
          <Text style={[styles.toSide, { color: sideColor(cell.side) }]} numberOfLines={1}>
            {cell.side} 残り{left}
          </Text>
        </Pressable>
      );
    }
    // チームを選んでいるときは、チームのTOV・リバウンドだけ押せる
    const disabled = !selected || (isBench && !TEAM_EVENT_TYPES.includes(cell.type));
    return (
      <Pressable
        key={cell.type}
        accessibilityRole="button"
        accessibilityLabel={cell.label}
        disabled={disabled}
        onPress={() => record(cell.type)}
        style={({ pressed }) => [
          styles.cell,
          styles.action,
          cell.tone === 'made' && styles.actionMade,
          cell.tone === 'miss' && styles.actionMiss,
          disabled && styles.actionDisabled,
          step?.target === 'made2' && cell.type === 'FG2_MADE' && styles.hint,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.actionText, cell.tone === 'made' && { color: colors.primaryText }]}>{cell.label}</Text>
      </Pressable>
    );
  };

  // 残り時間の入力エラーはシート内に表示する（アラートは出さない）
  const periodLength = periodSeconds(period, game);
  const subClockError =
    subSheet && parseClockDigits(subSheet.clock, periodLength) === undefined
      ? Number(subSheet.clock.slice(-2)) >= 60
        ? `秒は00〜59で入力してください（${clockDigitsLabel(subSheet.clock)} は入力できません）`
        : `残り時間は ${clockDigitsLabel(String(periodLength / 60) + '00')} までです`
      : null;

  const selectedLabel = selected
    ? `${selected.side} ${
        isBench ? 'チーム' : `#${bundle.roster.find((r) => r.id === selected.rosterId)?.number ?? '?'}`
      }`
    : '選手を選択';
  const clockEditError =
    clockEdit !== null && clockEdit !== '' && parseClockDigits(clockEdit, periodLength) === undefined
      ? Number(clockEdit.slice(-2)) >= 60
        ? '秒は00〜59で入力してください'
        : `残り時間は ${clockDigitsLabel(String(periodLength / 60) + '00')} までです`
      : null;
  const pad = { paddingLeft: insets.left + 10, paddingRight: insets.right + 10 };

  return (
    <View style={styles.screen}>
      <View style={[styles.top, pad, { paddingTop: insets.top }]}>
        <View style={[styles.sideBar, { backgroundColor: colors.teamAOnInk }]} />
        {/* チーム名のタップでも「チーム」を選べる（背番号と同じ感覚で、チームのTOV・リバウンドを付ける） */}
        <Text
          accessibilityRole="button"
          accessibilityLabel={`A ${teamName('A')} チームを選ぶ`}
          onPress={() => select('A', BENCH)}
          suppressHighlighting
          style={styles.topName}
          numberOfLines={1}
        >
          {teamName('A')}
        </Text>
        <Text num style={styles.topScore}>
          {state.A.score}
        </Text>
        <GameClock game={game} period={period} onToggle={toggleClock} onEdit={openClockEdit} onExpire={expireClock} />
        <Text num style={styles.topScore}>
          {state.B.score}
        </Text>
        <Text
          accessibilityRole="button"
          accessibilityLabel={`B ${teamName('B')} チームを選ぶ`}
          onPress={() => select('B', BENCH)}
          suppressHighlighting
          style={[styles.topName, styles.textRight]}
          numberOfLines={1}
        >
          {teamName('B')}
        </Text>
        <View style={[styles.sideBar, { backgroundColor: colors.teamBOnInk }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ファウル状況"
          onPress={() => {
            setFoulsOpen(true);
            if (practice) setPracticeFlags((f) => ({ ...f, foulsViewed: true }));
          }}
          hitSlop={6}
          style={[styles.foulsButton, step?.target === 'fouls' && styles.hintOnInk]}
        >
          <Text style={styles.foulsButtonText}>ファウル状況</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ランニングスコア"
          onPress={() => setScoreOpen(true)}
          hitSlop={6}
          style={styles.foulsButton}
        >
          <Text style={styles.foulsButtonText}>スコア</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="メニュー" onPress={menu} hitSlop={8} style={styles.menu}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.primaryText} />
        </Pressable>
      </View>

      <View style={[styles.main, pad, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {teamPanel('A')}

        <View style={styles.center}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step ? `練習 ${step.index}/${step.total} ${step.text}` : '記録ログを開く'}
            onPress={() => {
              if (!step) setLogOpen(true);
            }}
            style={[
              styles.strip,
              selected && { backgroundColor: sideBg(selected.side) },
              step && styles.stripPractice,
            ]}
          >
            {step ? (
              <>
                <Text style={styles.stripStep}>
                  練習 {step.index}/{step.total}
                </Text>
                <Text style={[styles.stripMain, styles.stripGuide]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {step.text}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="練習をスキップ"
                  onPress={skipPractice}
                  hitSlop={10}
                  style={styles.stripSkip}
                >
                  <Text style={styles.stripSkipText}>スキップ</Text>
                </Pressable>
              </>
            ) : (
              <>
                {notice && !selected ? (
                  <Text style={[styles.stripMain, styles.stripNotice]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {notice}
                  </Text>
                ) : (
                  <>
                    <Text style={[styles.stripMain, !selected && { color: colors.sub }]} numberOfLines={1}>
                      {selected ? `${selectedLabel} の記録をえらぶ` : '選手をタップ'}
                    </Text>
                    <Text style={styles.stripRecent} numberOfLines={1}>
                      {recent.length ? `直前：${recent[0]}` : '記録なし'}
                    </Text>
                  </>
                )}
              </>
            )}
          </Pressable>

          {ACTIONS.map((row, r) => (
            <View key={r} style={styles.gridRow}>
              {row.map(actionButton)}
            </View>
          ))}

          <View style={styles.utilRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="UNDO"
              onPress={undo}
              style={[styles.util, styles.undo, step?.target === 'undo' && styles.utilHint]}
            >
              <Ionicons name="arrow-undo" size={16} color={colors.warn} />
              <Text style={[styles.utilText, styles.utilShrink, { color: colors.warn }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                取り消す
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="印を付ける"
              accessibilityHint="あとで見直したい場面に印を付ける。続けて押すと外す"
              onPress={mark}
              // 第4Qは「残り2分」が並んで狭くなるので、旗だけにして幅をゆずる
              style={[styles.util, period === RULES.regulationPeriods && styles.utilNarrow]}
            >
              <Ionicons name="flag" size={14} color={colors.accentInk} />
              {period !== RULES.regulationPeriods && (
                <Text style={styles.utilText} numberOfLines={1}>
                  印
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={marks > 0 ? `ログ 印${marks}件` : 'ログ'}
              onPress={() => setLogOpen(true)}
              style={styles.util}
            >
              <Text style={styles.utilText} numberOfLines={1}>
                ログ
              </Text>
              {marks > 0 && (
                <Text num style={styles.markCount}>
                  {marks}
                </Text>
              )}
            </Pressable>
            {period === RULES.regulationPeriods && (
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="残り2分"
                accessibilityState={{ checked: state.lastTwoMinutes }}
                onPress={() => {
                  setLastTwoMinutes(db, gameId, !state.lastTwoMinutes);
                  reload();
                }}
                style={[styles.util, state.lastTwoMinutes && { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.utilText, state.lastTwoMinutes && { color: colors.primaryText }]}>残り2分</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Q終了"
              onPress={finishPeriod}
              style={[styles.util, { backgroundColor: colors.accent }, step?.target === 'endPeriod' && styles.utilHint]}
            >
              <Text style={styles.utilText}>{periodLabel(period)} 終了</Text>
            </Pressable>
          </View>
        </View>

        {teamPanel('B')}
      </View>

      <Modal
        visible={foulSheet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFoulSheet(null)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <Pressable style={styles.backdrop} onPress={() => setFoulSheet(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{isBench ? `${selected?.side} ベンチ` : selectedLabel} のファウル</Text>
            <Row>
              <Text style={styles.sheetLabel}>種類</Text>
              {(isBench ? BENCH_FOUL_KINDS : PLAYER_FOUL_KINDS).map((k) => (
                <Chip
                  key={k}
                  label={k}
                  active={foulSheet?.kind === k}
                  color={colors.danger}
                  onPress={() => setFoulSheet({ kind: k, ft: DEFAULT_FT[k] })}
                />
              ))}
            </Row>
            <Row>
              <Text style={styles.sheetLabel}>FT数</Text>
              {[0, 1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  active={foulSheet?.ft === n}
                  onPress={() => setFoulSheet((s) => (s ? { ...s, ft: n } : s))}
                />
              ))}
            </Row>
            <Row>
              <Button title="キャンセル" variant="secondary" onPress={() => setFoulSheet(null)} style={styles.flex} />
              <Button
                title="記録"
                variant="danger"
                style={styles.flex}
                onPress={() => {
                  const foul = foulSheet;
                  setFoulSheet(null);
                  if (foul) record('FOUL', foul);
                  if (practice) setPracticeFlags((f) => ({ ...f, foulSheetUsed: true }));
                }}
              />
            </Row>
          </Pressable>
        </Pressable>
        <DialogHost />
      </Modal>

      <Modal
        visible={adding !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAdding(null)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <Pressable style={styles.backdrop} onPress={() => setAdding(null)}>
          <Pressable style={styles.padSheet} onPress={() => undefined}>
            <Row>
              <Text style={[styles.sheetTitle, styles.flex, adding && { color: sideColor(adding.side) }]} numberOfLines={1}>
                {adding?.side} に背番号を追加
              </Text>
              <Text num style={styles.padDisplay}>{adding?.number || '–'}</Text>
            </Row>
            <View style={styles.padGrid}>
              {KEYPAD.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === '⌫' ? '1文字消す' : k}
                  onPress={() =>
                    setAdding((a) =>
                      a
                        ? { ...a, number: k === '⌫' ? a.number.slice(0, -1) : (a.number + k).slice(0, 2) }
                        : a,
                    )
                  }
                  style={({ pressed }) => [styles.padKey, pressed && styles.pressed]}
                >
                  <Text num style={styles.padKeyText}>{k}</Text>
                </Pressable>
              ))}
            </View>
            <Row>
              <Button title="キャンセル" variant="secondary" onPress={() => setAdding(null)} style={styles.flex} />
              <Button title="追加" disabled={!adding?.number} onPress={addNumber} style={styles.flex} />
            </Row>
          </Pressable>
        </Pressable>
        <DialogHost />
      </Modal>

      <Modal
        visible={subSheet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSubSheet(null)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <Pressable style={styles.backdrop} onPress={() => setSubSheet(null)}>
          {subSheet && (
            <Pressable style={styles.subSheet} onPress={() => undefined}>
              <Row>
                <Text style={[styles.sheetTitle, styles.flex, { color: sideColor(subSheet.side) }]} numberOfLines={1}>
                  {subSheet.side} の交代　コートに出る選手を選ぶ
                </Text>
                <Text
                  style={[
                    styles.subCount,
                    subSheet.court.length > ON_COURT_MAX && { color: colors.danger },
                  ]}
                >
                  {subSheet.court.length}/{ON_COURT_MAX}人
                </Text>
              </Row>
              <View style={styles.padGrid}>
                {state[subSheet.side].players.map((p) => {
                  const on = subSheet.court.includes(p.roster.id);
                  const out = p.status === 'fouledOut' || p.status === 'disqualified';
                  return (
                    <Chip
                      key={p.roster.id}
                      label={p.roster.number}
                      active={on}
                      disabled={out && !on}
                      color={sideColor(subSheet.side)}
                      onPress={() =>
                        setSubSheet((cur) =>
                          cur
                            ? {
                                ...cur,
                                court: on
                                  ? cur.court.filter((id) => id !== p.roster.id)
                                  : [...cur.court, p.roster.id],
                              }
                            : cur,
                        )
                      }
                    />
                  );
                })}
              </View>
              <Row>
                <Text style={styles.sheetLabel}>残り</Text>
                <Text num style={styles.subClock}>{clockDigitsLabel(subSheet.clock)}</Text>
                <View style={[styles.padGrid, styles.flex]}>
                  {KEYPAD.map((k) => (
                    <Pressable
                      key={k}
                      accessibilityRole="button"
                      accessibilityLabel={k === '⌫' ? '1文字消す' : `残り時間 ${k}`}
                      onPress={() =>
                        setSubSheet((cur) =>
                          cur
                            ? {
                                ...cur,
                                clockAuto: false,
                                clock:
                                  k === '⌫'
                                    ? cur.clock.slice(0, -1)
                                    : ((cur.clockAuto ? '' : cur.clock) + k).slice(0, 4),
                              }
                            : cur,
                        )
                      }
                      style={({ pressed }) => [styles.subKey, pressed && styles.pressed]}
                    >
                      <Text num style={styles.subKeyText}>{k}</Text>
                    </Pressable>
                  ))}
                </View>
              </Row>
              {subClockError ? (
                <Text style={[styles.subHint, styles.subError]}>{subClockError}</Text>
              ) : (
                <Text style={styles.subHint}>
                  残り時間は任意です（例：6分32秒 → 632）。時計を動かしていれば自動で入ります。Qの切れ目の交代は入れなくても正確です。
                </Text>
              )}
              <Row>
                <Button title="キャンセル" variant="secondary" onPress={() => setSubSheet(null)} style={styles.flex} />
                <Button
                  title="交代を記録"
                  disabled={subSheet.court.length > ON_COURT_MAX || subClockError !== null}
                  onPress={confirmSub}
                  style={styles.flex}
                />
              </Row>
            </Pressable>
          )}
        </Pressable>
        <DialogHost />
      </Modal>

      <Modal
        visible={clockEdit !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setClockEdit(null)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <Pressable style={styles.backdrop} onPress={() => setClockEdit(null)}>
          <Pressable style={styles.padSheet} onPress={() => undefined}>
            <Row>
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                {periodLabel(period)} 残り時間{clockAtOpen !== '' ? `（いま ${clockDigitsLabel(clockAtOpen)}）` : ''}
              </Text>
              <Text num style={styles.clockDisplay}>{clockDigitsLabel(clockEdit ?? '')}</Text>
            </Row>
            <View style={styles.padGrid}>
              {KEYPAD.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === '⌫' ? '1文字消す' : `残り時間 ${k}`}
                  onPress={() =>
                    setClockEdit((cur) => (cur === null ? cur : k === '⌫' ? cur.slice(0, -1) : (cur + k).slice(0, 4)))
                  }
                  style={({ pressed }) => [styles.padKey, pressed && styles.pressed]}
                >
                  <Text num style={styles.padKeyText}>{k}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.subHint, clockEditError !== null && styles.subError]}>
              {clockEditError ?? '会場の時計に合わせます（例：6分32秒 → 632）。上の時計はタップで動く・止まる、長押しでこの画面が開きます。'}
            </Text>
            <Row>
              <Button
                title="使わない"
                variant="ghost"
                onPress={() => {
                  resetClock(db, gameId);
                  reload();
                  setClockEdit(null);
                }}
              />
              <Button title="キャンセル" variant="secondary" onPress={() => setClockEdit(null)} style={styles.flex} />
              <Button
                title="合わせる"
                disabled={!clockEdit || clockEditError !== null}
                onPress={confirmClock}
                style={styles.flex}
              />
            </Row>
          </Pressable>
        </Pressable>
        <DialogHost />
      </Modal>

      <EventLogSheet visible={logOpen} bundle={bundle} onClose={() => setLogOpen(false)} onChanged={reload} />

      <TopSheet visible={foulsOpen} title="ファウル状況" onClose={() => setFoulsOpen(false)}>
        <FoulBoard
          names={{ A: teamName('A'), B: teamName('B') }}
          teams={{ A: state.A, B: state.B }}
          events={bundle.events}
          period={period}
        />
      </TopSheet>

      <TopSheet visible={scoreOpen} title="ランニングスコア（現在まで）" onClose={() => setScoreOpen(false)}>
        <View style={[styles.scoreSheet, { height: height - 130 }]}>
          {scoreOpen && <WebView originWhitelist={['*']} source={{ html: scoreHtml }} style={styles.webview} />}
        </View>
      </TopSheet>
    </View>
  );
}

const GAP = 5;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 2,
  },
  sideBar: { width: 8, height: 26, borderRadius: 4 },
  topName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: colors.primaryText },
  textRight: { textAlign: 'right' },
  topScore: { fontSize: 38, lineHeight: 44, minWidth: 44, textAlign: 'center', color: colors.primaryText },
  foulsButton: { height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.inkSoft, justifyContent: 'center' },
  foulsButtonText: { fontSize: 12, fontWeight: '800', color: colors.primaryText },
  menu: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, flexDirection: 'row', gap: 10, paddingTop: 6 },
  team: { flex: 1, gap: GAP },
  center: { flex: 1.5, gap: GAP },
  teamInfo: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  infoCount: { fontSize: 16, lineHeight: 18, color: colors.text },
  dots: { flexDirection: 'row', gap: 3 },
  foulDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.disabled },
  bonus: { fontSize: 11, fontWeight: '800', color: colors.danger },
  teamButtons: { height: 38, flexDirection: 'row', gap: GAP },
  teamButton: { flex: 1, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  teamButtonText: { fontSize: 13, fontWeight: '800', color: colors.text },
  teamButtonSub: { fontSize: 9, fontWeight: '800', color: colors.sub },
  strip: {
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  stripMain: { fontSize: 14, fontWeight: '800', color: colors.text },
  // 練習の案内。次に押す場所は、同じ色の太い枠で示す
  stripPractice: { backgroundColor: colors.accent },
  stripStep: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryText,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  stripGuide: { flex: 1, minWidth: 0, color: colors.accentText },
  stripSkip: { paddingHorizontal: 6, paddingVertical: 4 },
  stripSkipText: { fontSize: 12, fontWeight: '800', color: colors.accentText, textDecorationLine: 'underline' },
  hint: { borderColor: colors.accent, borderWidth: 4 },
  hintOnInk: { borderColor: colors.accent, borderWidth: 3 },
  utilHint: { borderColor: colors.primary, borderWidth: 3 },
  stripNotice: { flex: 1, minWidth: 0, color: colors.warn },
  markCount: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: 9,
    overflow: 'hidden',
  },
  scoreSheet: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  webview: { flex: 1, backgroundColor: colors.card },
  clockDisplay: { minWidth: 96, textAlign: 'center', fontSize: 34, color: colors.text },
  stripRecent: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.mute },
  utilRow: { height: 40, flexDirection: 'row', gap: GAP },
  util: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  utilNarrow: { flex: 0.5 },
  utilShrink: { flexShrink: 1 },
  utilText: { fontSize: 13, fontWeight: '800', color: colors.text },
  undo: { backgroundColor: colors.warnBg },
  toSide: { fontSize: 10, fontWeight: '800' },
  gridRow: { flex: 1, flexDirection: 'row', gap: GAP },
  cell: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmpty: { flex: 1 },
  player: { backgroundColor: colors.card, borderColor: colors.card },
  cellWarn: { backgroundColor: colors.warnBg, borderColor: colors.warnBg },
  cellOut: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },
  number: { fontSize: 28, lineHeight: 30, color: colors.text },
  foulCount: { position: 'absolute', top: 2, right: 6, fontSize: 11, fontWeight: '700', color: colors.sub },
  outText: { position: 'absolute', bottom: 1, fontSize: 10, fontWeight: '700', color: colors.sub },
  action: { backgroundColor: colors.card, borderColor: colors.card },
  actionMade: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionMiss: { borderColor: colors.primary },
  actionDisabled: { opacity: 0.35 },
  actionText: { fontSize: 17, fontWeight: '800', color: colors.text },
  pressed: { opacity: 0.5 },
  foul: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBg },
  foulText: { fontSize: 18, fontWeight: '800', color: colors.dangerInk },
  foulHint: { fontSize: 9, color: colors.dangerInk },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(22,32,58,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: { width: 380, maxWidth: '100%', backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sheetLabel: { width: 44, fontSize: 14, color: colors.sub },
  cellBenched: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg, opacity: 0.75 },
  numberBenched: { fontSize: 22, color: colors.sub },
  // ベンチの選手の小さいボタン
  numberCompact: { fontSize: 17, lineHeight: 19 },
  foulCountCompact: { top: 0, right: 3, fontSize: 9 },
  outTextCompact: { bottom: 0, fontSize: 8 },
  subSheet: { width: 640, maxWidth: '100%', backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 8 },
  subCount: { fontSize: 16, fontWeight: '800', color: colors.text },
  subClock: { width: 76, textAlign: 'center', fontSize: 30, color: colors.text },
  subKey: {
    width: 38,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subKeyText: { fontSize: 22, color: colors.text },
  subHint: { fontSize: 11, color: colors.sub },
  subError: { fontSize: 13, fontWeight: '700', color: colors.danger },
  padSheet: { width: 440, maxWidth: '100%', backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10 },
  padDisplay: { minWidth: 64, textAlign: 'center', fontSize: 34, color: colors.text },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  padKey: {
    width: 62,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyText: { fontSize: 26, color: colors.text },
});
