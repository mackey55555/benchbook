import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// OTA反映確認用の文言。`eas update` の前にここを書き換えると、反映されたか目で確認できる。
const OTA_CHECK_LABEL = 'CP0: 初回ビルド';

// 開発ビルド・Expo Go では expo-updates が無効で、確認APIは reject される
const canCheckUpdate = Updates.isEnabled && !__DEV__;

export default function HomeScreen() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const rows: [label: string, value: string][] = [
    ['アプリのバージョン', Constants.expoConfig?.version ?? '-'],
    ['OTA updateId', Updates.updateId ?? '-'],
    ['起動元', Updates.isEmbeddedLaunch ? 'ビルド同梱' : 'OTA'],
    ['channel', Updates.channel ?? '-'],
    ['runtimeVersion', Updates.runtimeVersion ?? '-'],
    ['update作成日時', Updates.createdAt?.toLocaleString('ja-JP') ?? '-'],
  ];

  // checkAutomatically: NEVER のため、更新は手動でのみ確認・取得する。
  // 取得した更新は次回の起動時に適用する（SPEC 7章）。
  const checkForUpdate = async () => {
    setBusy(true);
    setStatus('更新を確認中…');
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setStatus('最新です（新しい更新はありません）');
        return;
      }
      setStatus('更新をダウンロード中…');
      await Updates.fetchUpdateAsync();
      setStatus('更新を取得しました。アプリを終了して再起動すると適用されます');
    } catch (e) {
      setStatus(`更新の確認に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{OTA_CHECK_LABEL}</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowValue} selectable>
            {value}
          </Text>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={!canCheckUpdate || busy}
        onPress={checkForUpdate}
        style={({ pressed }) => [
          styles.button,
          (!canCheckUpdate || busy) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>更新を確認</Text>
      </Pressable>
      <Text style={styles.status}>
        {canCheckUpdate ? status : '開発ビルドではOTAの確認はできません'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: '#fff',
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
  },
  row: {
    gap: 4,
  },
  rowLabel: {
    fontSize: 13,
    color: '#666',
  },
  rowValue: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  button: {
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f6feb',
  },
  buttonDisabled: {
    backgroundColor: '#b0b8c4',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  status: {
    fontSize: 14,
    color: '#333',
  },
});
