import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "@/lib/supabase/env";

/**
 * ログインを求めず、接続情報だけを確かめる。
 *
 * ── ログインを外した経緯 ────────────────────────────────────
 * 社内で使うツールで、利用者ごとの権限差が無いため、毎回ログインを
 * 求める意味が薄かった。現在はログイン画面を出さず、そのまま業務画面を
 * 使えるようにしてある。
 *
 * ── そのぶんの守り方 ────────────────────────────────────────
 * DB へは必ずサーバー側から触り、その際にブラウザへ渡らない鍵
 * （SUPABASE_SERVICE_ROLE_KEY）を使う。公開鍵で DB を直接叩かれても
 * 何もできないよう、DB 側の権限は authenticated のままにしてある。
 * lib/supabase/env.ts と lib/supabase/server.ts を参照。
 * ────────────────────────────────────────────────────────────
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 接続情報が無いままでは何も表示できないので、設定手順へ案内する
  if (!readSupabaseEnv()) {
    if (pathname === "/setup") return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    /*
     * 静的アセットと画像最適化を除く全ルート
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
