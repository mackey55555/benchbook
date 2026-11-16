import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { db } from '@/db/client';
import {
  addRosterEntry,
  deleteGame,
  listPlayers,
  listTeams,
  loadRosterFromTeam,
  removeRosterEntry,
  saveRosterAsTeam,
  setOwnSide,
  setStaffName,
  setStarter,
  startGame,
  toggleCaptain,
  updateGame,
  updateRosterEntry,
} from '@/db/repo';
import { RULES } from '@/domain/rules';
import type { Player } from '@/db/schema';
import type { Side } from '@/domain/types';
import { Button, Card, Chip, CommitInput, Row, SectionTitle, Segmented, styles as ui } from '@/ui/components';
import { HelpButton } from '@/ui/HelpButton';
import { Text } from '@/ui/Text';
import { colors, sideColor } from '@/ui/theme';
import { attempt, useGame } from '@/ui/useGame';
import { DialogHost, showDialog } from '@/ui/dialog';

function parseMinutes(text: string, fallback: number): number {
  const n = Number.parseInt(text, 10);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : fallback;
}

export default function PrepScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { bundle, reload } = useGame(gameId);
  const [teamPicker, setTeamPicker] = useState<Side | null>(null);
  // 読み込むチームを選んだあと、今日来ている選手を選ぶ（任意。そのまま読み込めば全員）
  const [attendance, setAttendance] = useState<{
    side: Side;
    teamId: string;
    teamName: string;
    players: Player[];
    picked: string[];
  } | null>(null);
  const [draft, setDraft] = useState<Record<Side, { number: string; name: string }>>({
    A: { number: '', name: '' },
    B: { number: '', name: '' },
  });

  if (!bundle) return null;
  const { game, roster, staff } = bundle;
  const isPrep = game.status === 'prep';

  const run = (action: () => void): boolean => {
    const ok = attempt(action);
    reload();
    return ok;
  };

  const addEntry = (side: Side) => {
    if (run(() => addRosterEntry(db, gameId, side, draft[side]))) {
      setDraft((d) => ({ ...d, [side]: { number: '', name: '' } }));
    }
  };

  const doStart = () => {
    if (!run(() => startGame(db, gameId))) return;
    router.replace(`/games/${gameId}/live`);
  };

  // 交代・出場時間は先発（最初にコートに立つ5人）を起点に記録する
  const start = () => {
    const starters = roster.filter((r) => r.side === game.ownSide && r.isStarter).length;
    if (starters === RULES.startersCount) return doStart();
    showDialog(
      '自チームの先発が5名選ばれていません',
      `現在 ${starters}名です。交代と出場時間を記録するには、先発を5名選んでから開始してください。`,
      [
        { text: '戻って選ぶ', style: 'cancel' },
        { text: 'このまま開始', onPress: doStart },
      ],
    );
  };

  const confirmDelete = () =>
    showDialog('試合を削除', 'この試合を削除します。元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          deleteGame(db, gameId);
          router.back();
        },
      },
    ]);

  const teamSection = (side: Side) => {
    const isOwn = game.ownSide === side;
    const entries = roster.filter((r) => r.side === side);
    const starters = entries.filter((r) => r.isStarter).length;
    const hc = staff.find((s) => s.side === side && s.role === 'HC')?.name ?? '';
    return (
      <Card key={side}>
        <Row>
          <Text style={[styles.sideTag, { backgroundColor: sideColor(side) }]}>チーム{side}</Text>
          <Text style={styles.sideNote}>{isOwn ? '自チーム' : '相手チーム'}</Text>
          <View style={styles.flex} />
          <Text style={styles.sideNote}>
            登録 {entries.length}/{RULES.maxRosterSize}　先発 {starters}/{RULES.startersCount}
          </Text>
        </Row>
        <CommitInput
          value={side === 'A' ? game.teamAName : game.teamBName}
          onCommit={(v) =>
            run(() => updateGame(db, gameId, side === 'A' ? { teamAName: v.trim() } : { teamBName: v.trim() }))
          }
          placeholder="チーム名"
          accessibilityLabel={`チーム${side}の名前`}
        />
        <CommitInput
          value={hc}
          onCommit={(v) => run(() => setStaffName(db, gameId, side, 'HC', v))}
          placeholder="HC名（任意）"
          accessibilityLabel={`チーム${side}のHC名`}
        />
        <Row>
          <Button title="保存済みチームから読み込む" variant="secondary" small onPress={() => setTeamPicker(side)} />
          {!isOwn && (
            <Button
              title="チームを保存"
              variant="secondary"
              small
              onPress={() => {
                if (run(() => saveRosterAsTeam(db, gameId, side))) {
                  showDialog('保存しました', '次の試合から「保存済みチームから読み込む」で呼び出せます。');
                }
              }}
            />
          )}
        </Row>

        {entries.map((r) => (
          <Row key={r.id}>
            <CommitInput
              value={r.number}
              onCommit={(v) => run(() => updateRosterEntry(db, r.id, { number: v }))}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.number}
              accessibilityLabel="背番号"
            />
            <CommitInput
              value={r.name}
              onCommit={(v) => run(() => updateRosterEntry(db, r.id, { name: v }))}
              placeholder="氏名（任意）"
              style={styles.flex}
              accessibilityLabel="氏名"
            />
            <Chip label="先発" active={r.isStarter} onPress={() => run(() => setStarter(db, r.id, !r.isStarter))} />
            <Chip label="C" active={r.isCaptain} onPress={() => run(() => toggleCaptain(db, r.id))} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`#${r.number} を外す`}
              hitSlop={8}
              onPress={() => run(() => removeRosterEntry(db, r.id))}
              style={styles.remove}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </Row>
        ))}

        {entries.length < RULES.maxRosterSize && (
          <Row>
            <TextInput
              value={draft[side].number}
              onChangeText={(v) => setDraft((d) => ({ ...d, [side]: { ...d[side], number: v } }))}
              placeholder="番号"
              placeholderTextColor={colors.sub}
              keyboardType="number-pad"
              maxLength={2}
              style={[ui.input, styles.number]}
              accessibilityLabel={`チーム${side}に追加する背番号`}
            />
            <TextInput
              value={draft[side].name}
              onChangeText={(v) => setDraft((d) => ({ ...d, [side]: { ...d[side], name: v } }))}
              placeholder="氏名（任意）"
              placeholderTextColor={colors.sub}
              style={[ui.input, styles.flex]}
              returnKeyType="done"
              onSubmitEditing={() => addEntry(side)}
            />
            <Button title="追加" small disabled={!draft[side].number.trim()} onPress={() => addEntry(side)} />
          </Row>
        )}
      </Card>
    );
  };

  const teams = teamPicker ? listTeams(db) : [];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{ title: isPrep ? '試合準備' : '試合情報・出場登録', headerRight: () => <HelpButton topic="start" /> }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionTitle>試合情報</SectionTitle>
        <Card>
          <Row>
            <Text style={styles.label}>日付</Text>
            <CommitInput
              value={game.date}
              onCommit={(v) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) run(() => updateGame(db, gameId, { date: v.trim() }));
                else {
                  showDialog('確認してください', '日付は 2026-11-15 の形式で入力してください');
                  reload();
                }
              }}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              style={styles.flex}
            />
          </Row>
          <Row>
            <Text style={styles.label}>大会名</Text>
            <CommitInput
              value={game.leagueName}
              onCommit={(v) => run(() => updateGame(db, gameId, { leagueName: v.trim() }))}
              style={styles.flex}
            />
          </Row>
          <Row>
            <Text style={styles.label}>会場</Text>
            <CommitInput
              value={game.venue}
              onCommit={(v) => run(() => updateGame(db, gameId, { venue: v.trim() }))}
              style={styles.flex}
            />
          </Row>
          <Row>
            <Text style={styles.label}>Q時間</Text>
            <CommitInput
              value={String(game.periodMinutes)}
              onCommit={(v) =>
                run(() => updateGame(db, gameId, { periodMinutes: parseMinutes(v, game.periodMinutes) }))
              }
              keyboardType="number-pad"
              maxLength={2}
              style={styles.number}
            />
            <Text style={styles.unit}>分</Text>
            <Text style={styles.label}>延長</Text>
            <CommitInput
              value={String(game.otMinutes)}
              onCommit={(v) => run(() => updateGame(db, gameId, { otMinutes: parseMinutes(v, game.otMinutes) }))}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.number}
            />
            <Text style={styles.unit}>分</Text>
          </Row>
          {isPrep && (
            <Row>
              <Text style={styles.label}>自チーム</Text>
              <Segmented
                style={styles.flex}
                options={[
                  { value: 'A', label: 'スコアシートのA' },
                  { value: 'B', label: 'スコアシートのB' },
                ]}
                value={game.ownSide}
                onChange={(v) => run(() => setOwnSide(db, gameId, v))}
              />
            </Row>
          )}
        </Card>

        <SectionTitle>出場登録（最大{RULES.maxRosterSize}名）</SectionTitle>
        {teamSection('A')}
        {teamSection('B')}

        {isPrep ? (
          <>
            <Button title="試合開始" variant="accent" onPress={start} style={styles.start} />
            <Button title="この試合を削除" variant="ghost" onPress={confirmDelete} />
          </>
        ) : (
          <Button title="閉じる" onPress={() => router.back()} style={styles.start} />
        )}
      </ScrollView>

      <Modal
        visible={teamPicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTeamPicker(null)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <Pressable style={styles.backdrop} onPress={() => setTeamPicker(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>読み込むチームを選択</Text>
            <Text style={styles.sideNote}>記録のない出場登録は置き換わります</Text>
            <ScrollView style={styles.sheetList}>
              {teams.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  style={styles.sheetRow}
                  onPress={() => {
                    const side = teamPicker;
                    setTeamPicker(null);
                    if (!side) return;
                    const active = listPlayers(db, t.id).filter((p) => p.isActive);
                    // 上限以内なら全員を選んだ状態から、超えるなら空から選ぶ
                    setAttendance({
                      side,
                      teamId: t.id,
                      teamName: t.name,
                      players: active,
                      picked: active.length <= RULES.maxRosterSize ? active.map((p) => p.id) : [],
                    });
                  }}
                >
                  <Text style={styles.sheetRowText} numberOfLines={1}>
                    {t.name}
                    {t.isOwn ? '（自チーム）' : ''}
                  </Text>
                  <Text style={styles.sideNote}>{listPlayers(db, t.id).filter((p) => p.isActive).length}名</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button title="キャンセル" variant="secondary" onPress={() => setTeamPicker(null)} />
          </Pressable>
        </Pressable>
        <DialogHost />
      </Modal>

      <Modal
        visible={attendance !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAttendance(null)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <Pressable style={styles.backdrop} onPress={() => setAttendance(null)}>
          {attendance && (
            <Pressable style={styles.sheet} onPress={() => undefined}>
              <Row>
                <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                  今日来ている選手
                </Text>
                <Text
                  style={[
                    styles.pickCount,
                    attendance.picked.length > RULES.maxRosterSize && { color: colors.danger },
                  ]}
                >
                  {attendance.picked.length}/{RULES.maxRosterSize}人
                </Text>
              </Row>
              <Text style={styles.sideNote}>
                {attendance.teamName}　来ていない選手はタップして外します。記録のない出場登録は置き換わります
              </Text>
              <Row>
                <Button
                  title="全員を選ぶ"
                  variant="secondary"
                  small
                  onPress={() => setAttendance((a) => (a ? { ...a, picked: a.players.map((p) => p.id) } : a))}
                />
                <Button
                  title="全員を外す"
                  variant="secondary"
                  small
                  onPress={() => setAttendance((a) => (a ? { ...a, picked: [] } : a))}
                />
              </Row>
              <ScrollView style={styles.sheetList}>
                {attendance.players.map((p) => {
                  const on = attendance.picked.includes(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`#${p.number} ${p.name}`}
                      style={styles.sheetRow}
                      onPress={() =>
                        setAttendance((a) =>
                          a ? { ...a, picked: on ? a.picked.filter((id) => id !== p.id) : [...a.picked, p.id] } : a,
                        )
                      }
                    >
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on && <Ionicons name="checkmark" size={18} color={colors.primaryText} />}
                      </View>
                      <Text num style={styles.pickNumber}>
                        {p.number}
                      </Text>
                      <Text style={styles.sheetRowText} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Row>
                <Button title="キャンセル" variant="secondary" onPress={() => setAttendance(null)} style={styles.flex} />
                <Button
                  title={`${attendance.picked.length}人を読み込む`}
                  disabled={attendance.picked.length === 0 || attendance.picked.length > RULES.maxRosterSize}
                  style={styles.flex}
                  onPress={() => {
                    const a = attendance;
                    setAttendance(null);
                    run(() => loadRosterFromTeam(db, gameId, a.side, a.teamId, a.picked));
                  }}
                />
              </Row>
            </Pressable>
          )}
        </Pressable>
        <DialogHost />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 10, paddingBottom: 80 },
  label: { width: 64, fontSize: 14, color: colors.sub },
  unit: { fontSize: 14, color: colors.sub, marginRight: 8 },
  number: { width: 56, textAlign: 'center' },
  sideTag: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  sideNote: { fontSize: 12, color: colors.sub },
  remove: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 22, color: colors.sub },
  start: { marginTop: 12, minHeight: 56 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: colors.card, borderRadius: 20, padding: 18, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sheetList: { flexGrow: 0 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pickCount: { fontSize: 16, fontWeight: '800', color: colors.text },
  pickNumber: { width: 36, fontSize: 22, textAlign: 'center', color: colors.text },
  check: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sheetRowText: { flex: 1, fontSize: 16, color: colors.text },
});
