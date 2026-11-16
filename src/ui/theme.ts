/**
 * デザイン「コートサイド」。濃紺（インク）を土台に、ボールのオレンジを差し色にする。
 * 文字色と背景の組み合わせはコントラスト比 4.5:1 以上になる組だけを使う。
 */
export const colors = {
  bg: '#f2f4f8',
  card: '#ffffff',
  text: '#16203a',
  sub: '#5a6478',
  line: '#dde2ea',
  /** 主ボタン（濃紺に白文字） */
  primary: '#16203a',
  primaryText: '#ffffff',
  /** 一番押してほしいボタン（オレンジに濃紺文字）。白文字は載せない */
  accent: '#ff7a2f',
  accentText: '#16203a',
  accentBg: '#ffe8d9',
  /** 淡いオレンジの面に載せる文字 */
  accentInk: '#8a3a0c',
  /** 濃紺の面の上に置く補助の文字・面 */
  onInkSub: '#c9d1e6',
  inkSoft: '#2b3757',
  onInkAccent: '#ffd9c2',
  onInkMute: '#8e9ab8',
  /** グレーの面に載せる文字 */
  mute: '#414b60',
  danger: '#c8321f',
  dangerBg: '#fbd9d3',
  /** 淡い赤の面に載せる文字 */
  dangerInk: '#7a1d10',
  warn: '#6b4700',
  warnBg: '#ffe9b8',
  ok: '#0a6b42',
  okBg: '#d9f2e5',
  disabled: '#aab2c0',
  disabledBg: '#e3e7ee',
  teamA: '#3f51e0',
  teamABg: '#e6e9ff',
  teamB: '#0b7f75',
  teamBBg: '#ddf3f0',
  /** グラフの系列色（自チーム・相手）。色覚の違いでも見分けられる組として検証済み */
  chartOwn: '#3f51e0',
  chartOpp: '#e0611b',
  /** 濃紺の面の上で使うチーム色 */
  teamAOnInk: '#7c8bff',
  teamBOnInk: '#4fd1c1',
} as const;

export const sideColor = (side: 'A' | 'B') => (side === 'A' ? colors.teamA : colors.teamB);
export const sideBg = (side: 'A' | 'B') => (side === 'A' ? colors.teamABg : colors.teamBBg);

/** 読み込むフォント名（src/app/_layout.tsx の useFonts と対応） */
export const fonts = {
  medium: 'MPLUSRounded1c_500Medium',
  bold: 'MPLUSRounded1c_700Bold',
  heavy: 'MPLUSRounded1c_800ExtraBold',
  /** 得点・背番号・時計などの数字 */
  num: 'BarlowCondensed_700Bold',
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 24 } as const;

/** タップ対象の最小サイズ（SPEC 5-4） */
export const MIN_TAP = 56;
