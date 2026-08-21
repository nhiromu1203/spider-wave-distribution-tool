import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readServiceRoleKey, requireSupabaseEnv } from "./env";

/**
 * Server Component / Server Action / Route Handler 用のクライアント。
 *
 * ── 権限について ────────────────────────────────────────────
 * ログインを不要にしたため、利用者は認証されていない。DB の権限は
 * authenticated に与えてあるので、そのままでは何も読み書きできない。
 *
 * サーバー側でだけ使える鍵（service_role）があればそれを使う。
 * この鍵はブラウザへ送られないため、DB を直接叩かれることはない。
 * 鍵が未設定なら公開鍵のまま動く（ログインを使う運用に戻した場合）。
 * ────────────────────────────────────────────────────────────
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();
  const key = readServiceRoleKey() ?? anonKey;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは Cookie を書けない。
          // セッション更新は middleware 側で行われるため無視してよい。
        }
      },
    },
  });
}
