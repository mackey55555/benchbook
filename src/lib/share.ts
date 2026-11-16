import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { BackupData } from '@/db/backup';

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|%#\s]+/g, '_').slice(0, 60) || 'benchbook';
}

/** 共有用のファイルを置く場所の名前の先頭 */
const SHARE_DIR_PREFIX = 'share-';

/**
 * 共有用の新しい置き場所を作る。
 * 同じ名前のファイルを「消してから作り直す」と、作り直したはずのファイルが存在しない状態になり、
 * 2回目以降の共有が「ファイルにアクセスできない」で失敗した。毎回別の場所に書き出して、消す処理を挟まない。
 * 前回までの置き場所は、ここで片づける（失敗しても共有は続ける）。
 */
function newShareDirectory(): Directory {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof Directory && entry.name.startsWith(SHARE_DIR_PREFIX)) entry.delete();
    }
  } catch {
    // 片づけられなくても、キャッシュ領域なのでOSがいずれ消す
  }
  const dir = new Directory(Paths.cache, `${SHARE_DIR_PREFIX}${Date.now()}`);
  dir.create();
  return dir;
}

/**
 * ファイルを共有シートに渡す。候補を順に試し、最初に渡せたものを使う。
 * 日本語を含む名前のファイルは、端末によって共有シートに断られることがあるので、
 * 英数字だけの名前の写しと、元のファイルを控えにする。
 * `File.exists` は日本語を含む名前で正しく判定できないことがあるため、事前の確認には使わない。
 * すべて失敗したときは、原因を調べられるよう候補ごとの状況をエラーに含める。
 */
async function shareFirst(candidates: File[], options: Sharing.SharingOptions): Promise<void> {
  const failures: string[] = [];
  for (const file of candidates) {
    try {
      await Sharing.shareAsync(encodeURI(decodeURI(file.uri)), options);
      return;
    } catch (e) {
      failures.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`共有シートに渡せませんでした（${failures.join(' ／ ')}）`);
}

/** 共有用の置き場所に、指定した名前で写しを作る。作れなければ null */
function copyInto(dir: Directory, source: File, name: string): File | null {
  try {
    const target = new File(dir, name);
    source.copy(target);
    return target;
  } catch {
    return null;
  }
}

/** JSONを共有シートに渡す */
export async function shareJson(data: BackupData, baseName: string): Promise<void> {
  const dir = newShareDirectory();
  const plain = new File(dir, 'benchbook.json');
  plain.create();
  plain.write(JSON.stringify(data));
  const named = copyInto(dir, plain, `${safeName(baseName)}.json`);
  await shareFirst([named, plain].filter((f): f is File => f !== null), {
    mimeType: 'application/json',
    UTI: 'public.json',
  });
}

/** HTMLをA4のPDFにして共有シートに渡す */
export async function sharePdf(html: string, baseName: string): Promise<void> {
  const printed = await Print.printToFileAsync({ html, width: 595, height: 842 });
  // 印刷機能が書き出したファイルはそのまま残し、わかりやすい名前の写しを作って渡す。
  // 写しを渡せないときは、書き出されたファイルそのものを渡す（名前は機械的なものになる）
  const original = new File(printed.uri);
  const dir = newShareDirectory();
  const named = copyInto(dir, original, `${safeName(baseName)}.pdf`);
  const plain = copyInto(dir, original, 'benchbook.pdf');
  await shareFirst([named, plain, original].filter((f): f is File => f !== null), {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
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
