"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_REDIRECT, safeRedirectTarget } from "@/lib/auth/redirect";
import { describeSignInError } from "./errors";
import { headers } from "next/headers";

export type LoginState = { error: string | null };

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? DEFAULT_REDIRECT);

  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: describeSignInError(error.message) };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectTarget(next));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Google でのログインを始める。
 *
 * 許可アカウントかどうかは、ここでは判断できない（まだ誰か分からない）。
 * Google から戻ってきた /auth/callback で user.email を見て判断する。
 */
export async function signInWithGoogle(next: string): Promise<{ error: string }> {
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const target = safeRedirectTarget(next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(target)}`,
      // 既にGoogleにログイン済みなら、そのまま通す（毎回選択させない）
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) {
    return {
      error: error?.message ?? "Google ログインを開始できませんでした。",
    };
  }

  redirect(data.url);
}
