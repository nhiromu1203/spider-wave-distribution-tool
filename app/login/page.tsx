import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-bold">配布対象リスト管理</h1>
        <p className="mb-6 text-xs text-[var(--text-muted)]">
          社内共同利用ツールです。付与されたアカウントでログインしてください。
        </p>

        <LoginForm next={next ?? "/buildings"} />

        <p className="mt-6 text-xs text-[var(--text-muted)]">
          アカウントの発行は管理者が Supabase の Authentication から行います。
        </p>
      </div>
    </main>
  );
}
