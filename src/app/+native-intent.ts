/**
 * アプリの外から開かれたアドレスを、アプリ内の画面のアドレスに直す。
 * チームへの招待リンク（https://arti-lab.jp/products/benchbook/join/<コード>）を、参加の画面（/join/<コード>）へ送る。
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const match = path.match(/\/products\/benchbook\/join\/([0-9a-f]{36})/i);
  return match ? `/join/${match[1].toLowerCase()}` : path;
}
