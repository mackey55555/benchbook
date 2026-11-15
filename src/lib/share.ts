import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { BackupData } from '@/db/backup';

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'benchbook';
}

function writeCacheFile(name: string, content: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file;
}

/** JSONを共有シートに渡す */
export async function shareJson(data: BackupData, baseName: string): Promise<void> {
  const file = writeCacheFile(`${safeName(baseName)}.json`, JSON.stringify(data));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
}

/** HTMLをA4のPDFにして共有シートに渡す */
export async function sharePdf(html: string, baseName: string): Promise<void> {
  const printed = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const target = new File(Paths.cache, `${safeName(baseName)}.pdf`);
  if (target.exists) target.delete();
  new File(printed.uri).move(target);
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

export async function shareImage(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
}

/** 共有シートからJSONファイルを選び、中身の文字列を返す（キャンセル時は null） */
export async function pickJsonText(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'public.json', 'text/plain'] });
  if (picked.canceled) return null;
  return picked.result.text();
}
