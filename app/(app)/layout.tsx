import Link from "next/link";

const NAV = [
  { href: "/buildings", label: "建物一覧" },
  { href: "/duplicates", label: "重複候補の確認" },
  { href: "/import", label: "過去配布リスト取込" },
];

/**
 * 業務画面の枠。
 *
 * ログインを求めないため、利用者の情報は表示しない
 * （メールアドレスの表示とログアウトは外した）。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Link href="/buildings" className="font-bold whitespace-nowrap">
            配布対象リスト管理
          </Link>

          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
    </div>
  );
}
