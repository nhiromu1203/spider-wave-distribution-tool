import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { decideAccess, providerOf } from "@/lib/auth/access";

const PUBLIC_PATHS = ["/login", "/setup", "/auth"];

/**
 * セッション Cookie の更新と、未ログインユーザーの遮断。
 * ログインしていないユーザーは建物情報・配布履歴に到達できない。
 */
export async function proxy(request: NextRequest) {
  const env = readSupabaseEnv();
  const { pathname } = request.nextUrl;

  // Supabase 未設定時はセットアップ案内へ誘導する
  if (!env) {
    if (pathname === "/setup") return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Supabase に到達できない場合も未ログイン扱いにする（保護側に倒す）
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  // ── 使ってよいアカウントかを毎回確かめる ──────────────────
  // ログインできること自体は誰でもできる。どのアカウントかは
  // 認証後の user.email でしか分からないため、保護ページを開くたびに見る。
  // 画面から隠すだけでは防御にならない。
  if (user) {
    const decision = decideAccess(user.email, providerOf(user));
    if (!decision.allowed) {
      // 権限の無いセッションは残さない
      await supabase.auth.signOut();

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?error=${encodeURIComponent(decision.reason)}`;

      const denied = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) {
        denied.cookies.set(cookie.name, "", { ...cookie, maxAge: 0 });
      }
      return denied;
    }
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/buildings";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的アセットと画像最適化を除く全ルート
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
