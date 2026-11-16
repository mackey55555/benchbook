import { File, Paths } from 'expo-file-system';

/**
 * 「一度だけ出す」ものの済み印。端末内の小さなファイルの有無で覚える
 * （データベースの形を変えずに済ませるため）。読み書きに失敗しても、アプリは止めない。
 */
function flagFile(name: string): File {
  return new File(Paths.document, `flag-${name}`);
}

export function hasFlag(name: string): boolean {
  try {
    return flagFile(name).exists;
  } catch {
    return false;
  }
}

export function setFlag(name: string): void {
  try {
    const file = flagFile(name);
    if (!file.exists) file.create();
  } catch {
    // 覚えられなくても、次回もう一度案内が出るだけ
  }
}

/** はじめての起動時の案内（練習するか・スキップするか）を出した */
export const FLAG_WELCOMED = 'welcomed';
