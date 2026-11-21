import { useRef, useState, type ComponentRef } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';

import { shareImage, sharePdf } from '@/lib/share';

import { Button, Row } from './components';
import { DialogHost, showDialog } from './dialog';
import { Text } from './Text';
import { WIDE_PAGE_WIDTH, colors } from './theme';

/** HTMLの横幅（px）。A4を96dpiで表した幅で、viewport と揃える */
const SHEET_WIDTH = 794;
const A4_RATIO = 297 / 210;
// 読み込み後に内容の高さを知らせる。画像は内容の全体を1枚に収める
const REPORT_HEIGHT = `(function(){var h=function(){window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight));};h();setTimeout(h,300);})();true;`;

/**
 * 共有用のシート（HTML）を表示し、PDF・画像で共有する。
 * html は開いている間だけ必要。name は共有するファイルの名前。
 */
export function ShareSheet(props: { visible: boolean; html: string; name: string; onClose: () => void }) {
  const { visible, html, name, onClose } = props;
  const { width } = useWindowDimensions();
  const sheetRef = useRef<ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const sheetWidth = Math.min(width, WIDE_PAGE_WIDTH) - 24;
  const scale = sheetWidth / SHEET_WIDTH;
  // 内容がA4より短くても、1枚分の高さは確保する
  const sheetHeight = Math.max(sheetWidth * A4_RATIO, (contentHeight ?? 0) * scale);

  const share = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showDialog('共有できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <Row style={styles.header}>
            <Text style={styles.title}>共有</Text>
            <View style={styles.flex} />
            <Button title="PDF" small variant="accent" disabled={busy} onPress={() => share(() => sharePdf(html, name))} />
            <Button
              title="画像"
              small
              variant="accent"
              disabled={busy}
              onPress={() => share(async () => shareImage(await captureRef(sheetRef, { format: 'png', quality: 1 })))}
            />
            <Button title="閉じる" small variant="secondary" onPress={onClose} />
          </Row>
          <ScrollView contentContainerStyle={styles.body}>
            <View ref={sheetRef} collapsable={false} style={[styles.sheet, { width: sheetWidth, height: sheetHeight }]}>
              {visible && (
                <WebView
                  originWhitelist={['*']}
                  source={{ html }}
                  style={styles.webview}
                  scrollEnabled={false}
                  injectedJavaScript={REPORT_HEIGHT}
                  onMessage={(e) => {
                    const h = Number(e.nativeEvent.data);
                    if (Number.isFinite(h) && h > 0) setContentHeight(h);
                  }}
                />
              )}
            </View>
            <Text style={styles.note}>
              画像は内容の全体を1枚にします。印刷や拡大にはPDFが向いています
            </Text>
          </ScrollView>
        </SafeAreaView>
        <DialogHost />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: 12, paddingVertical: 8 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  body: { width: '100%', maxWidth: WIDE_PAGE_WIDTH, alignSelf: 'center', padding: 12, gap: 8 },
  sheet: { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  webview: { flex: 1, backgroundColor: colors.card },
  note: { fontSize: 12, color: colors.sub },
});
