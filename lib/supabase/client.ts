"use client";

import { createBrowserClient } from "@supabase/ssr";
import { classifySupabaseKey, requireSupabaseEnv } from "./env";

/**
 * ブラウザ側の Supabase クライアント。
 *
 * ── secret key を絶対に持ち込まない ─────────────────────────
 * NEXT_PUBLIC_ が付いた値はビルド時にブラウザ向けのコードへ埋め込まれ、
 * 誰でも読める状態になる。ここに secret key（sb_secret_…）が入ると
 * RLS を迂回する鍵が公開され、全データが読み書きできてしまう。
 *
 * requireSupabaseEnv() でも弾いているが、影響が大きいため
 * ブラウザ用の生成口でも独立して確認する。
 * ────────────────────────────────────────────────────────────
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv();

  if (classifySupabaseKey(anonKey) === "secret") {
    throw new Error(
      "secret key（sb_secret_…）はブラウザで使用できません。NEXT_PUBLIC_SUPABASE_ANON_KEY に Publishable key（sb_publishable_…）を設定してください。",
    );
  }

  return createBrowserClient(url, anonKey);
}
