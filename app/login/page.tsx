import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { createClient } from "@/lib/supabase/server";
import { decideAccess, providerOf } from "@/lib/auth/access";
import { safeRedirectTarget } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeRedirectTarget(next);

  // ── 既にログインしていれば画面を出さない ──────────────────
  // セッションが残っているあいだは、毎回ログインを求めない。
  // 期限が切れていれば getUser() が空を返すので、そのときだけ画面を出す。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && decideAccess(user.email, providerOf(user)).allowed) {
    redirect(target);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-bold">配布対象リスト管理</h1>
        <p className="mb-6 text-xs text-[var(--text-muted)]">
          社内共同利用ツールです。付与されたアカウントでログインしてください。
        </p>

        {error && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <GoogleSignInButton next={target} />

        <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span className="h-px flex-1 bg-[var(--border)]" />
          または
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <LoginForm next={target} />

        <p className="mt-6 text-xs text-[var(--text-muted)]">
          アカウントの発行は管理者が Supabase の Authentication から行います。
        </p>
      </div>
    </main>
  );
}
