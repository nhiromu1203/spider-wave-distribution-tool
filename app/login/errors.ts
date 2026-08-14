import "server-only";

/**
 * ログイン失敗の理由を、担当者が次に何をすればよいか分かる文にする。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * Supabase が返す "Invalid API key" は、実際には
 * 「接続情報の値そのものが壊れている」ことを指す。
 * これをそのまま画面に出すと、利用者はパスワードの問題だと誤解し、
 * 環境変数の設定ミスに気付けない。
 *
 * 実際に Supabase の応答を確認した結果は次のとおり。
 *   値が正しい            → 200
 *   引用符ごと貼り付け     → 401 Invalid API key
 *   変数名ごと貼り付け     → 401 Invalid API key
 *   値が途中で欠けている   → 401 Invalid API key
 *   値が空                → 401 No API key found in request
 * つまり "Invalid API key" は「キーはあるが違う」場合にだけ出る。
 * ────────────────────────────────────────────────────────────
 */

import { diagnoseSupabaseEnv } from "@/lib/supabase/env";

export function describeSignInError(message: string): string {
  if (message === "Invalid login credentials") {
    return "メールアドレスまたはパスワードが違います。";
  }

  if (/invalid api key/i.test(message)) {
    return [
      "Supabase の API キーが正しくありません。",
      "設定した値が実際のキーと一致していないか、値以外のもの（引用符・変数名・改行）が混ざっています。",
      "Vercel の Environment Variables で NEXT_PUBLIC_SUPABASE_ANON_KEY を貼り直し、再デプロイしてください。",
      ...describeEnvShape(),
    ].join(" ");
  }

  if (/no api key found/i.test(message)) {
    return [
      "Supabase の API キーが設定されていません。",
      "Vercel の Environment Variables に NEXT_PUBLIC_SUPABASE_ANON_KEY を追加し、Production にも適用したうえで再デプロイしてください。",
    ].join(" ");
  }

  if (/signups? not allowed|email logins are disabled/i.test(message)) {
    return "このアカウントではログインできません。Supabase の Authentication → Users で利用者が作成済みか確認してください。";
  }

  if (/email not confirmed/i.test(message)) {
    return "メールアドレスが未確認です。Supabase の Authentication → Users で該当ユーザーを確認済みにしてください。";
  }

  return `ログインに失敗しました: ${message}`;
}

/**
 * 設定値の「形」だけを説明する。値そのものは決して出さない。
 * 種別（publishable / legacy）は公開情報なので出しても差し支えない。
 */
function describeEnvShape(): string[] {
  const { problems, keyKind, keyPresent } = diagnoseSupabaseEnv();

  if (problems.length > 0) return [`検出した問題: ${problems.join(" ")}`];
  if (!keyPresent) return [];

  const kindLabel =
    keyKind === "publishable"
      ? "Publishable key（sb_publishable_…）"
      : keyKind === "legacy_jwt"
        ? "旧方式のキー（eyJ…）"
        : "不明な形式";

  return [
    `現在設定されているキーの種別: ${kindLabel}。`,
    "形式は正しいため、値が別プロジェクトのものか、古いキーである可能性があります。",
    "Supabase の Project Settings → API Keys の値と照合してください。",
  ];
}
