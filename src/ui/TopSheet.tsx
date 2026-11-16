import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors, radius } from './theme';

/**
 * 画面の上からせり出すパネル。試合中に状況をさっと確認して、すぐ閉じるためのもの。
 * 画面のいちばん外側のViewの最後に置く。
 */
export function TopSheet(props: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { visible, title, onClose, children } = props;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  // 閉じるアニメーションが終わるまでは描画したままにする
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 320 : 220,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, progress]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;
  const panelHeight = height - Math.max(insets.bottom, 12) - 8;
  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable accessibilityLabel="パネルの外側（タップで閉じる）" style={styles.fill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            maxHeight: panelHeight,
            paddingTop: insets.top + 8,
            paddingLeft: insets.left + 14,
            paddingRight: insets.right + 14,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-panelHeight, 0] }) }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={8} style={styles.close}>
            <Ionicons name="chevron-up" size={18} color={colors.text} />
            <Text style={styles.closeText}>閉じる</Text>
          </Pressable>
        </View>
        {children}
        <View style={styles.grip} />
      </Animated.View>
    </View>
  );
}

const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  root: { ...fill, zIndex: 500, elevation: 500 },
  fill: { flex: 1 },
  backdrop: { ...fill, backgroundColor: 'rgba(22,32,58,0.5)' },
  panel: {
    backgroundColor: colors.bg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingBottom: 6,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  close: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  closeText: { fontSize: 13, fontWeight: '800', color: colors.text },
  grip: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.disabled, marginTop: 2 },
});
