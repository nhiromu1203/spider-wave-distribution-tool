import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { decideAccess, providerOf } from "@/lib/auth/access";
import { safeRedirectTarget } from "@/lib/auth/redirect";

/**
 * Google ログインの戻り先。
 *
 * ── ここで必ず確かめること ──────────────────────────────────
 * Google のログイン自体は誰でも成功する。どのアカウントで入ってきたかは
 * ここで受け取る user.email でしか分からない。
 *
 * 許可していないアカウントだった場合は、その場でサインアウトして
 * セッションを残さない。セッションが残ると、以降のページで弾いても
 * 「ログインはできているのに何も見えない」状態になり分かりにくい。
 * ────────────────────────────────────────────────────────────
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectTarget(searchParams.get("next"));

  const env = readSupabaseEnv();
  if (!env) return NextResponse.redirect(`${origin}/setup`);

  // Google 側で拒否・中断された場合
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("ログインを完了できませんでした。")}`,
    );
  }

  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        error?.message ?? "ログインを完了できませんでした。",
      )}`,
    );
  }

  const decision = decideAccess(data.user.email, providerOf(data.user));

  if (!decision.allowed) {
    // 権限の無いアカウントのセッションは残さない
    await supabase.auth.signOut();

    const denied = NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(decision.reason)}`,
    );
    // サインアウトで消える Cookie を確実に反映させる
    for (const cookie of response.cookies.getAll()) {
      denied.cookies.set(cookie.name, "", { ...cookie, maxAge: 0 });
    }
    return denied;
  }

  return response;
}
