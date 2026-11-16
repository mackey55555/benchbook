import { useEffect, useId, useSyncExternalStore } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { Button } from './components';
import { Text } from './Text';
import { colors, radius } from './theme';

export interface DialogButton {
  text: string;
  /** cancel＝閉じるだけの控えめなボタン、destructive＝削除などの赤いボタン */
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

/**
 * アプリ内ダイアログ。OS標準のアラートは使わない
 * （iOSでは横向き固定の画面でも、アラートを出すと端末の向きに回転してしまうため）。
 * 呼び出し方は Alert.alert と同じ。
 */
let current: DialogState | null = null;
// 表示先の候補。Modal の中では、その Modal 内に置いた DialogHost に出す（最後に置かれたものが最前面）
let hosts: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function showDialog(title: string, message?: string, buttons?: DialogButton[]): void {
  Keyboard.dismiss();
  current = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
  emit();
}

function close(button?: DialogButton): void {
  current = null;
  emit();
  button?.onPress?.();
}

/** ダイアログの表示場所。ルートと、各 Modal の中身の最後に置く */
export function DialogHost() {
  const id = useId();
  useEffect(() => {
    hosts = [...hosts, id];
    emit();
    return () => {
      hosts = hosts.filter((h) => h !== id);
      emit();
    };
  }, [id]);
  const dialog = useSyncExternalStore(subscribe, () => current);
  const top = useSyncExternalStore(subscribe, () => hosts[hosts.length - 1]);
  const visible = dialog !== null && top === id;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close(current?.buttons.find((b) => b.style === 'cancel'));
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  if (!visible || !dialog) return null;
  const cancel = dialog.buttons.find((b) => b.style === 'cancel');
  // 3つ以上は縦に並べる（メニュー）。キャンセルは最後に置く
  const stacked = dialog.buttons.length > 2;
  const ordered = stacked
    ? [...dialog.buttons.filter((b) => b.style !== 'cancel'), ...dialog.buttons.filter((b) => b.style === 'cancel')]
    : dialog.buttons;
  return (
    <Pressable
      accessibilityLabel="閉じる"
      style={styles.backdrop}
      onPress={() => (cancel || dialog.buttons.length === 1 ? close(cancel) : undefined)}
    >
      <Pressable accessibilityRole="alert" style={styles.card} onPress={() => undefined}>
        <Text style={styles.title}>{dialog.title}</Text>
        {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
        <View style={stacked ? styles.column : styles.row}>
          {ordered.map((b) => (
            <Button
              key={b.text}
              title={b.text}
              variant={
                stacked
                  ? b.style === 'cancel'
                    ? 'ghost'
                    : b.style === 'destructive'
                      ? 'dangerSoft'
                      : 'secondary'
                  : b.style === 'cancel'
                    ? 'secondary'
                    : b.style === 'destructive'
                      ? 'danger'
                      : 'primary'
              }
              onPress={() => close(b)}
              style={stacked ? undefined : styles.flex}
            />
          ))}
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: 'rgba(22,32,58,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: 20,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  message: { fontSize: 14, lineHeight: 21, color: colors.sub },
  row: { flexDirection: 'row', gap: 8, marginTop: 6 },
  column: { gap: 8, marginTop: 6 },
  flex: { flex: 1 },
});
