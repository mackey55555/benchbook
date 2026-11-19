import { Redirect } from 'expo-router';

/**
 * Googleでサインインのあと、ブラウザから戻ってくるアドレス（benchbook://auth）の受け皿。
 * サインインの結果そのものは、ブラウザを開いた側（session.ts）が受け取るので、ここではチームプランの画面へ戻すだけ。
 */
export default function AuthReturn() {
  return <Redirect href="/team" />;
}
