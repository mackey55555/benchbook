import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { BackupData } from '@/db/backup';

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|%#\s]+/g, '_').slice(0, 60) || 'benchbook';
}

function writeCacheFile(name: string, content: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file;
}

/**
 * ファイルを共有シートに渡す。
 * iOSの共有は、日本語などを含むパスをそのまま渡すと「ファイルにアクセスできない」と失敗することがあるため、
 * パスをパーセントエンコードして渡す。それでも失敗したら、英数字だけの名前に写して渡し直す。
 */
async function shareFile(file: File, fallbackName: string, options: Sharing.SharingOptions): Promise<void> {
  try {
    await Sharing.shareAsync(encodeURI(decodeURI(file.uri)), options);
  } catch {
    const plain = new File(Paths.cache, fallbackName);
    if (plain.exists) plain.delete();
    file.copy(plain);
    await Sharing.shareAsync(plain.uri, options);
  }
}

/** JSONを共有シートに渡す */
export async function shareJson(data: BackupData, baseName: string): Promise<void> {
  const file = writeCacheFile(`${safeName(baseName)}.json`, JSON.stringify(data));
  await shareFile(file, 'benchbook.json', { mimeType: 'application/json', UTI: 'public.json' });
}

/** HTMLをA4のPDFにして共有シートに渡す */
export async function sharePdf(html: string, baseName: string): Promise<void> {
  const printed = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const target = new File(Paths.cache, `${safeName(baseName)}.pdf`);
  if (target.exists) target.delete();
  new File(printed.uri).move(target);
  await shareFile(target, 'benchbook.pdf', { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
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
