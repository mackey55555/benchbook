import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import {
  addEvent,
  addRosterEntry,
  endPeriod,
  isPeriodEnded,
  setLastTwoMinutes,
  undoLastEvent,
} from '@/db/repo';
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
import { colors, sideBg, sideColor } from '@/ui/theme';
import { attempt, useGame } from '@/ui/useGame';

const BENCH = 'bench';
type Selection = { side: Side; rosterId: string };

const GRID_COLUMNS = 3;
const GRID_ROWS = 5;

const ACTIONS: { type: EventType; label: string; tone: 'made' | 'miss' | 'stat' }[][] = [
  [
    { type: 'FG2_MADE', label: '2P ○', tone: 'made' },
    { type: 'FG3_MADE', label: '3P ○', tone: 'made' },
    { type: 'FT_MADE', label: 'FT ○', tone: 'made' },
  ],
  [
    { type: 'FG2_MISS', label: '2P ×', tone: 'miss' },
    { type: 'FG3_MISS', label: '3P ×', tone: 'miss' },
    { type: 'FT_MISS', label: 'FT ×', tone: 'miss' },
  ],
  [
    { type: 'OREB', label: 'OR', tone: 'stat' },
    { type: 'DREB', label: 'DR', tone: 'stat' },
    { type: 'AST', label: 'AST', tone: 'stat' },
  ],
  [
    { type: 'STL', label: 'STL', tone: 'stat' },
    { type: 'BLK', label: 'BLK', tone: 'stat' },
    { type: 'TOV', label: 'TOV', tone: 'stat' },
  ],
];

const STATUS_TEXT = { fouledOut: '退場', disqualified: '失格' } as const;

export default function LiveScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { bundle, reload } = useGame(gameId);
  useKeepAwake();

  const [selected, setSelected] = useState<Selection | null>(null);
  const [foulSheet, setFoulSheet] = useState<{ kind: FoulKind; ft: number } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // 試合中の背番号追加（開始時に相手の番号が全員分かっていない場合のため）
  const [adding, setAdding] = useState<{ side: Side; number: string } | null>(null);

  const period = bundle?.game.currentPeriod ?? 1;
  const state = useMemo(
    () => (bundle ? deriveGameState(bundle.events, bundle.roster, period) : null),
    [bundle, period],
  );
  const recent = useMemo(
    () =>
      bundle
        ? activeEvents(bundle.events)
            .filter((e) => e.type !== 'L2M')
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
      }),
    );
    // 書き込み完了後に画面へ反映する
    reload();
    if (!ok) return;
    void Haptics.impactAsync(
      type === 'FOUL' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
    );
    // FTは続けて入力できるよう選択を維持する。それ以外は誤入力防止のため解除
    if (type !== 'FT_MADE' && type !== 'FT_MISS') setSelected(null);
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
    Alert.alert(`${name} のタイムアウト`, `記録しますか？（残り${state[side].timeoutsRemaining}回）`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '記録する',
        onPress: () => {
          const ok = attempt(() =>
            addEvent(db, { gameId, period, side, rosterId: null, type: 'TIMEOUT' }),
          );
          reload();
          if (ok) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const finishPeriod = () =>
    Alert.alert(`${periodLabel(period)} を終了`, 'オフィシャルとの照合に進みます。', [
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

  const menu = () =>
    Alert.alert('メニュー', undefined, [
      { text: '試合情報・出場登録を編集', onPress: () => router.push(`/games/${gameId}/prep`) },
      {
        text: 'ホームに戻る（試合は続行）',
        onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);

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
    setSelected((cur) => (cur?.side === side && cur.rosterId === rosterId ? null : { side, rosterId }));
  };

  const playerButton = (side: Side, p: PlayerState) => {
    const out = p.status === 'fouledOut' || p.status === 'disqualified';
    const active = selected?.side === side && selected.rosterId === p.roster.id;
    const warn = p.status === 'warning';
    return (
      <Pressable
        key={p.roster.id}
        accessibilityRole="button"
        accessibilityLabel={`${side} ${p.roster.number}番`}
        accessibilityState={{ selected: active, disabled: out }}
        disabled={out}
        onPress={() => select(side, p.roster.id)}
        style={[
          styles.cell,
          { backgroundColor: sideBg(side), borderColor: sideBg(side) },
          warn && styles.cellWarn,
          active && { backgroundColor: sideColor(side), borderColor: sideColor(side) },
          out && styles.cellOut,
        ]}
      >
        <Text
          style={[
            styles.number,
            warn && { color: colors.danger },
            active && { color: colors.primaryText },
            out && { color: colors.disabled },
          ]}
        >
          {p.roster.number}
        </Text>
        {out ? (
          <Text style={styles.outText}>{STATUS_TEXT[p.status as 'fouledOut' | 'disqualified']}</Text>
        ) : (
          p.fouls.total > 0 && (
            <Text
              style={[
                styles.foulCount,
                warn && { color: colors.danger },
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
    const name = (side === 'A' ? game.teamAName : game.teamBName) || `チーム${side}`;
    const benchActive = selected?.side === side && selected.rosterId === BENCH;
    const cells = [
      ...team.players.slice(0, RULES.maxRosterSize).map((p) => playerButton(side, p)),
      <Pressable
        key={BENCH}
        accessibilityRole="button"
        accessibilityLabel={`${side} ベンチ`}
        accessibilityState={{ selected: benchActive }}
        onPress={() => select(side, BENCH)}
        style={[styles.cell, styles.bench, benchActive && { backgroundColor: sideColor(side), borderColor: sideColor(side) }]}
      >
        <Text style={[styles.benchText, benchActive && { color: colors.primaryText }]}>ベンチ</Text>
        {team.coach.disqualified ? (
          <Text style={[styles.outText, { color: colors.danger }]}>HC失格</Text>
        ) : (
          team.coach.C + team.coach.B > 0 && (
            <Text style={[styles.foulCount, benchActive && { color: colors.primaryText }]}>
              F{team.coach.C + team.coach.B}
            </Text>
          )
        )}
      </Pressable>,
      ...(team.players.length < RULES.maxRosterSize
        ? [
            <Pressable
              key="add"
              accessibilityRole="button"
              accessibilityLabel={`${side} 背番号を追加`}
              onPress={() => setAdding({ side, number: '' })}
              style={[styles.cell, styles.addCell]}
            >
              <Text style={styles.addText}>＋番号</Text>
            </Pressable>,
          ]
        : []),
    ];
    const rows = Array.from({ length: GRID_ROWS }, (_, r) =>
      cells.slice(r * GRID_COLUMNS, (r + 1) * GRID_COLUMNS),
    );
    return (
      <View style={styles.team}>
        <View style={styles.teamHeader}>
          <Text style={[styles.teamName, { color: sideColor(side) }]} numberOfLines={1}>
            {side} {name}
          </Text>
          <Row style={styles.teamBadges}>
            <Text style={[styles.badge, team.inBonus && styles.badgeDanger]}>
              TF {team.teamFouls}
              {team.inBonus ? '　次からFT' : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${side} タイムアウト 残り${team.timeoutsRemaining}回`}
              disabled={team.timeoutsRemaining === 0}
              onPress={() => timeout(side)}
              hitSlop={8}
              style={[styles.toButton, team.timeoutsRemaining === 0 && styles.toButtonDisabled]}
            >
              <Text style={[styles.toText, team.timeoutsRemaining === 0 && { color: colors.sub }]}>
                TO 残{team.timeoutsRemaining}
              </Text>
            </Pressable>
          </Row>
        </View>
        {rows.map((row, r) => (
          <View key={r} style={styles.gridRow}>
            {Array.from({ length: GRID_COLUMNS }, (_, c) => row[c] ?? <View key={`e${c}`} style={styles.cellEmpty} />)}
          </View>
        ))}
      </View>
    );
  };

  const selectedLabel = selected
    ? `${selected.side} ${
        isBench ? 'ベンチ' : `#${bundle.roster.find((r) => r.id === selected.rosterId)?.number ?? '?'}`
      }`
    : '選手を選択';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.main}>
        {teamPanel('A')}

        <View style={styles.center}>
          <View style={styles.centerHeader}>
            <Row style={styles.scoreRow}>
              <Text style={[styles.score, { color: sideColor('A') }]}>{state.A.score}</Text>
              <Text style={styles.scoreSep}>-</Text>
              <Text style={[styles.score, { color: sideColor('B') }]}>{state.B.score}</Text>
            </Row>
            <Row style={styles.controls}>
              <Text style={styles.period}>{periodLabel(period)}</Text>
              {period === RULES.regulationPeriods && (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="残り2分"
                  accessibilityState={{ checked: state.lastTwoMinutes }}
                  onPress={() => {
                    setLastTwoMinutes(db, gameId, !state.lastTwoMinutes);
                    reload();
                  }}
                  style={[styles.control, state.lastTwoMinutes && styles.controlOn]}
                >
                  <Text style={[styles.controlText, state.lastTwoMinutes && { color: colors.primaryText }]}>
                    残り2分
                  </Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" onPress={finishPeriod} style={styles.control}>
                <Text style={styles.controlText}>Q終了</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="メニュー" onPress={menu} style={styles.control}>
                <Text style={styles.controlText}>≡</Text>
              </Pressable>
            </Row>
          </View>

          {ACTIONS.map((row, r) => (
            <View key={r} style={styles.gridRow}>
              {row.map((a) => {
                const disabled = !selected || isBench;
                return (
                  <Pressable
                    key={a.type}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    disabled={disabled}
                    onPress={() => record(a.type)}
                    style={({ pressed }) => [
                      styles.cell,
                      styles.action,
                      a.tone === 'made' && styles.actionMade,
                      disabled && styles.actionDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.actionText, a.tone === 'made' && { color: colors.ok }]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={styles.gridRow}>
            <Pressable
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
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.foulText}>FOUL</Text>
              <Text style={styles.foulHint}>{isBench ? 'タップで種類を選択' : 'タップ=P　長押し=種類・FT'}</Text>
            </Pressable>
          </View>
        </View>

        {teamPanel('B')}
      </View>

      <View style={styles.logBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="UNDO" onPress={undo} style={styles.undo}>
          <Text style={styles.undoText}>↶ UNDO</Text>
        </Pressable>
        <Text style={[styles.selected, selected && { color: sideColor(selected.side) }]}>{selectedLabel}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="記録ログを開く"
          onPress={() => setLogOpen(true)}
          style={styles.recent}
        >
          <Text style={styles.recentText} numberOfLines={1}>
            {recent.length ? `直近: ${recent.join(' / ')}` : '記録なし（タップでログ）'}
          </Text>
        </Pressable>
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
            <Text style={styles.sheetTitle}>{selectedLabel} のファウル</Text>
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
                }}
              />
            </Row>
          </Pressable>
        </Pressable>
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
              <Text style={styles.padDisplay}>{adding?.number || '–'}</Text>
            </Row>
            <View style={styles.padGrid}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'].map((k) => (
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
                  <Text style={styles.padKeyText}>{k}</Text>
                </Pressable>
              ))}
            </View>
            <Row>
              <Button title="キャンセル" variant="secondary" onPress={() => setAdding(null)} style={styles.flex} />
              <Button title="追加" disabled={!adding?.number} onPress={addNumber} style={styles.flex} />
            </Row>
          </Pressable>
        </Pressable>
      </Modal>

      <EventLogSheet visible={logOpen} bundle={bundle} onClose={() => setLogOpen(false)} onChanged={reload} />
    </SafeAreaView>
  );
}

const GAP = 4;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  main: { flex: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingTop: 2 },
  team: { flex: 1, gap: GAP },
  center: { flex: 1.15, gap: GAP },
  teamHeader: { height: 50, justifyContent: 'space-between' },
  teamName: { fontSize: 15, fontWeight: '800' },
  teamBadges: { justifyContent: 'space-between' },
  badge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.disabledBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  badgeDanger: { color: colors.primaryText, backgroundColor: colors.danger },
  toButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  toButtonDisabled: { borderColor: colors.line, backgroundColor: colors.disabledBg },
  toText: { fontSize: 13, fontWeight: '700', color: colors.primary, fontVariant: ['tabular-nums'] },
  gridRow: { flex: 1, flexDirection: 'row', gap: GAP },
  cell: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmpty: { flex: 1 },
  cellWarn: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  cellOut: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },
  number: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  foulCount: { position: 'absolute', top: 2, right: 5, fontSize: 11, fontWeight: '700', color: colors.sub },
  outText: { position: 'absolute', bottom: 1, fontSize: 10, fontWeight: '700', color: colors.sub },
  bench: { backgroundColor: colors.card, borderColor: colors.line },
  benchText: { fontSize: 14, fontWeight: '700', color: colors.text },
  centerHeader: { height: 50, justifyContent: 'space-between' },
  scoreRow: { justifyContent: 'center', gap: 10 },
  score: { fontSize: 28, lineHeight: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scoreSep: { fontSize: 22, lineHeight: 30, color: colors.sub },
  controls: { justifyContent: 'center', gap: 6 },
  period: { fontSize: 15, fontWeight: '800', color: colors.text, marginRight: 4 },
  control: {
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  controlOn: { backgroundColor: colors.warn, borderColor: colors.warn },
  controlText: { fontSize: 12, fontWeight: '700', color: colors.text },
  action: { backgroundColor: colors.card, borderColor: colors.line },
  actionMade: { backgroundColor: colors.okBg, borderColor: colors.okBg },
  actionDisabled: { opacity: 0.35 },
  actionText: { fontSize: 17, fontWeight: '800', color: colors.text },
  pressed: { opacity: 0.5 },
  foul: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  foulText: { fontSize: 18, fontWeight: '900', color: colors.danger },
  foulHint: { fontSize: 10, color: colors.danger },
  logBar: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 3 },
  undo: {
    height: '100%',
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.warnBg,
    justifyContent: 'center',
  },
  undoText: { fontSize: 14, fontWeight: '800', color: colors.warn },
  selected: { width: 92, fontSize: 14, fontWeight: '800', color: colors.sub, textAlign: 'center' },
  recent: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  recentText: { fontSize: 13, color: colors.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: 380, maxWidth: '100%', backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sheetLabel: { width: 44, fontSize: 14, color: colors.sub },
  addCell: { backgroundColor: 'transparent', borderColor: colors.line, borderStyle: 'dashed' },
  addText: { fontSize: 13, fontWeight: '700', color: colors.sub },
  padSheet: { width: 440, maxWidth: '100%', backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10 },
  padDisplay: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  padKey: {
    width: 62,
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyText: { fontSize: 22, fontWeight: '700', color: colors.text },
});
