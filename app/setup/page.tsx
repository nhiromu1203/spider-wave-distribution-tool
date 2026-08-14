import { diagnoseSupabaseEnv } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export default function SetupPage() {
  const { env, problems } = diagnoseSupabaseEnv();
  if (env) redirect("/buildings");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-xl font-bold">セットアップが必要です</h1>
      <p className="mb-6 text-[var(--text-muted)]">
        Supabase の接続情報が設定されていないため、まだデータベースに接続できません。
        以下の手順を実施してください。
      </p>

      {/*
        値が「入っているが正しくない」場合、原因が分からないまま
        Invalid API key に突き当たる。どの環境変数が問題なのかをここで示す。
        表示するのは変数名と形の異常だけで、値そのものは決して出さない。
      */}
      {problems.length > 0 && (
        <section className="card mb-6 border-l-4 border-l-[var(--danger,#dc2626)] p-4">
          <h2 className="mb-2 font-semibold">検出した問題</h2>
          <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Vercel で設定している場合は、Environment Variables を修正したあと
            再デプロイが必要です（NEXT_PUBLIC_ の値はビルド時に埋め込まれるため、
            保存しただけでは反映されません）。
          </p>
        </section>
      )}

      <ol className="space-y-4">
        {[
          {
            title: "1. Supabase プロジェクトを作成",
            body: "supabase.com にログインし、新しいプロジェクトを作成します（無料プランで可）。リージョンは Northeast Asia (Tokyo) を推奨します。",
          },
          {
            title: "2. DB スキーマを適用",
            body: "Supabase の SQL Editor を開き、リポジトリ内の supabase/migrations/0001_init.sql の内容をそのまま貼り付けて実行します。",
          },
          {
            title: "3. 接続情報を .env.local に設定",
            body: "Supabase の Project Settings > API から Project URL と anon public key を取得し、プロジェクト直下の .env.local に記述します（.env.example をコピーしてください）。",
          },
          {
            title: "4. 社内メンバーを招待",
            body: "Supabase の Authentication > Users から「Add user」で社内メンバーのメールアドレスとパスワードを登録します。一般公開しないため、サインアップ画面は用意していません。",
          },
          {
            title: "5. 開発サーバーを再起動",
            body: "npm run dev を再起動すると、この画面ではなくログイン画面が表示されます。",
          },
        ].map((step) => (
          <li key={step.title} className="card p-4">
            <h2 className="mb-1 font-semibold">{step.title}</h2>
            <p className="text-[var(--text-muted)]">{step.body}</p>
          </li>
        ))}
      </ol>

      <pre className="card mt-6 overflow-x-auto p-4 text-xs">
        {`# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...`}
      </pre>
    </main>
  );
}
