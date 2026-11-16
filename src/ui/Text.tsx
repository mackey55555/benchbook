import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from './theme';

function familyFor(weight: TextStyle['fontWeight']): string {
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 400 : Number(weight);
  if (w >= 800) return fonts.heavy;
  if (w >= 600) return fonts.bold;
  return fonts.medium;
}

/**
 * アプリ共通のText。丸ゴシックを使う。
 * カスタムフォントは太さごとに別ファミリーなので、fontWeight をファミリーに読み替える。
 * `num` を付けると数字用のフォント（得点・背番号）になる。
 */
export function Text({ style, num, ...rest }: TextProps & { num?: boolean }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = flat.fontFamily ?? (num ? fonts.num : familyFor(flat.fontWeight));
  return <RNText {...rest} style={[base.text, flat, { fontFamily, fontWeight: undefined }]} />;
}

const base = StyleSheet.create({ text: { color: colors.text } });
