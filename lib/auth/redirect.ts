/**
 * ログイン後の遷移先の検証。
 *
 * ── 塞いでいる問題 ──────────────────────────────────────────
 * 遷移先は /login?next=... で外から渡されるため、そのまま使うと
 * 任意のURLへ飛ばせてしまう（オープンリダイレクト）。
 *
 * 先頭が "/" かどうかだけを見る判定では不十分で、"//example.com" は
 * プロトコル相対URLとしてブラウザが外部サイトと解釈する。
 * "/\example.com" も一部のブラウザで同様に扱われる。
 * ────────────────────────────────────────────────────────────
 */

export const DEFAULT_REDIRECT = "/buildings";

/** アプリ内のパスならそのまま、そうでなければ既定の遷移先を返す */
export function safeRedirectTarget(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return DEFAULT_REDIRECT;

  // 外部サイトと解釈されうる形を除く
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_REDIRECT;

  return next;
}
