import { Dimensions, Platform } from 'react-native';

/**
 * iPadかどうか。iPadでは、縦に読む画面を縦横どちらの向きでも使えるようにする。
 * （手元の確認用のAndroidでは、画面の短い辺の長さで判定する）
 */
export const isTablet: boolean =
  Platform.OS === 'ios'
    ? Platform.isPad
    : Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height) >= 600;

/**
 * 横向きの入力画面（試合中・照合）で、文字と固定の高さに掛ける倍率。
 * ボタンは画面に合わせて広がるが、文字はそのままだとiPadでは小さく見えるので、合わせて大きくする。
 */
const TABLET_SCALE = 1.35;

/** iPadのときだけ大きくした寸法を返す。iPhoneではそのまま */
export const z = (n: number): number => (isTablet ? Math.round(n * TABLET_SCALE) : n);
