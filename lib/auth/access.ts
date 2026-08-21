/**
 * 誰がこのアプリを使えるかの判断。
 *
 * ── なぜ画面側だけで隠さないか ──────────────────────────────
 * Google でログインできること自体は誰にでもできる。どのアカウントで
 * 入ってきたかは、認証が終わったあとの user.email でしか分からない。
 *
 * そのため「ログイン画面に出さない」だけでは防御にならず、
 * 保護されたページを開くたびにサーバー側で確かめる必要がある。
 * ここはその判断を 1 箇所にまとめたもの。
 * ────────────────────────────────────────────────────────────
 */

/**
 * Google ログインを許可するアカウント。
 *
 * 環境変数 ALLOWED_GOOGLE_EMAILS に「,」区切りで書くと差し替えられる。
 * 未設定なら下の既定値を使う。秘密情報ではないので既定値を持たせてよい。
 */
const DEFAULT_ALLOWED_EMAILS = ["infor@spiderwaves.co.jp"];

export function allowedGoogleEmails(): string[] {
  const configured = process.env.ALLOWED_GOOGLE_EMAILS?.trim();
  const list = configured
    ? configured.split(",")
    : DEFAULT_ALLOWED_EMAILS;

  return list.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
}

/**
 * どの経路でログインしたかを表す。
 *
 * Supabase の user.app_metadata.provider に入る値をそのまま使う。
 * メールアドレスとパスワードでのログインは "email"。
 */
export type AuthProvider = string | null | undefined;

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export const NOT_ALLOWED_MESSAGE =
  "このGoogleアカウントにはアクセス権限がありません";

/**
 * ログイン済みの利用者がアプリを使ってよいかを判断する。
 *
 * ── 経路ごとの扱い ──────────────────────────────────────────
 * Google        … 許可アカウントと完全一致した場合だけ通す
 * メール＋パスワード … これまでどおり通す。アカウントの発行そのものを
 *                     管理者が Supabase の画面で行うため、そこが関門になる
 *
 * 判断に使うのは認証後の user.email であって、画面から送られてきた値では
 * ないことが要点。
 */
export function decideAccess(
  email: string | null | undefined,
  provider: AuthProvider,
): AccessDecision {
  const normalized = (email ?? "").trim().toLowerCase();

  if (!normalized) {
    return { allowed: false, reason: "メールアドレスを確認できませんでした。" };
  }

  // Google 以外（メール＋パスワード）は従来どおり
  if (provider !== "google") return { allowed: true };

  return allowedGoogleEmails().includes(normalized)
    ? { allowed: true }
    : { allowed: false, reason: NOT_ALLOWED_MESSAGE };
}

/** Supabase のユーザー情報から、ログイン経路を取り出す */
export function providerOf(user: {
  app_metadata?: { provider?: string | null } | null;
}): AuthProvider {
  return user.app_metadata?.provider ?? null;
}
