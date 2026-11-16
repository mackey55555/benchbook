import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from './theme';

/** その画面の使い方を開く「？」ボタン。topic は使い方ページの項目（src/app/help.tsx） */
export function HelpButton(props: { topic: string; label?: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label ?? 'この画面の使い方'}
      onPress={() => router.push({ pathname: '/help', params: { topic: props.topic } })}
      hitSlop={10}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="help-circle-outline" size={26} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
