export const colors = {
  bg: '#f4f5f7',
  card: '#ffffff',
  text: '#16181d',
  sub: '#667085',
  line: '#d9dde3',
  primary: '#1f6feb',
  primaryText: '#ffffff',
  danger: '#d92d20',
  dangerBg: '#fee4e2',
  warn: '#b54708',
  warnBg: '#fef0c7',
  ok: '#067647',
  okBg: '#d1fadf',
  disabled: '#c4c9d2',
  disabledBg: '#e9ebef',
  teamA: '#1f6feb',
  teamABg: '#e7f0ff',
  teamB: '#c2410c',
  teamBBg: '#ffeedd',
} as const;

export const sideColor = (side: 'A' | 'B') => (side === 'A' ? colors.teamA : colors.teamB);
export const sideBg = (side: 'A' | 'B') => (side === 'A' ? colors.teamABg : colors.teamBBg);

/** タップ対象の最小サイズ（SPEC 5-4） */
export const MIN_TAP = 56;
