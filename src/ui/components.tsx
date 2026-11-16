import { useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';
import { colors, fonts, radius } from './theme';

/** accent は画面でいちばん押してほしいボタンにだけ使う */
type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { title, onPress, variant = 'primary', disabled, small, style } = props;
  const bg = disabled
    ? colors.disabledBg
    : variant === 'primary'
      ? colors.primary
      : variant === 'accent'
        ? colors.accent
        : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.disabledBg
          : 'transparent';
  const fg = disabled
    ? colors.sub
    : variant === 'primary' || variant === 'danger'
      ? colors.primaryText
      : variant === 'accent'
        ? colors.accentText
        : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function SectionTitle(props: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{props.children}</Text>;
}

/** 入力中はローカルに持ち、フォーカスが外れたときに onCommit する入力欄 */
export function CommitInput(
  props: Omit<TextInputProps, 'value' | 'onChangeText'> & {
    value: string;
    onCommit: (value: string) => void;
  },
) {
  const { value, onCommit, style, ...rest } = props;
  const [text, setText] = useState(value);
  const [committed, setCommitted] = useState(value);
  // 保存済みの値が変わったら入力欄も合わせる
  if (committed !== value) {
    setCommitted(value);
    setText(value);
  }
  return (
    <TextInput
      {...rest}
      value={text}
      onChangeText={setText}
      onEndEditing={() => {
        if (text === value) return;
        onCommit(text);
        // 保存に失敗した（値が変わらない）場合は元の値に戻す
        setText(value);
      }}
      placeholderTextColor={colors.sub}
      style={[styles.input, style]}
    />
  );
}

export function Segmented<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, props.style]}>
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  color?: string;
}) {
  const color = props.color ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        styles.chip,
        props.active && { backgroundColor: color, borderColor: color },
        props.disabled && styles.chipDisabled,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          props.active && { color: colors.primaryText },
          props.disabled && { color: colors.disabled },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Row(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, props.style]}>{props.children}</View>;
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.sm },
  buttonText: { fontSize: 16, fontWeight: '800' },
  buttonTextSmall: { fontSize: 14 },
  pressed: { opacity: 0.6 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: fonts.medium,
    color: colors.text,
    backgroundColor: colors.card,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.disabledBg,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 14, color: colors.sub, fontWeight: '700' },
  segmentTextActive: { color: colors.text, fontWeight: '800' },
  chip: {
    minWidth: 44,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipDisabled: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
