import Link from "next/link";
import { DuplicateCard } from "@/components/DuplicateCard";
import {
  fetchPendingDuplicates,
  fetchResolvedDuplicates,
} from "@/lib/buildings/duplicates";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ building?: string }>;
}) {
  const { building } = await searchParams;
  const [pending, resolved] = await Promise.all([
    fetchPendingDuplicates(building ?? null),
    fetchResolvedDuplicates(20),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">重複候補の確認</h1>
        <p className="text-sm text-[var(--text-muted)]">
          過去に配布した物件と同一の可能性がある物件です。二重配布を避けるため、
          判定が怪しい物件は未配布一覧に出さずここに集めています。人が確認して振り分けてください。
        </p>
        {building && (
          <Link href="/duplicates" className="text-sm text-[var(--accent)] underline">
            すべての重複候補を表示する
          </Link>
        )}
      </header>

      {pending.length === 0 ? (
        <div className="card p-10 text-center text-[var(--text-muted)]">
          確認待ちの重複候補はありません。
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            確認待ち <strong>{pending.length}</strong> 件
          </p>
          {pending.map((c) => (
            <DuplicateCard key={c.id} candidate={c} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold">
            判断済みの履歴（直近 {resolved.length} 件）
          </summary>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="table-cell">新規取得物件</th>
                <th className="table-cell">過去配布候補</th>
                <th className="table-cell w-28">判断</th>
                <th className="table-cell w-40">判断日時</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => (
                <tr key={r.id}>
                  <td className="table-cell">{r.new_building?.building_name ?? "—"}</td>
                  <td className="table-cell">
                    {r.existing_building?.building_name ?? "—"}
                  </td>
                  <td className="table-cell">
                    {r.status === "same" ? "同じ建物" : "別の建物"}
                  </td>
                  <td className="table-cell tabular-nums">
                    {r.resolved_at
                      ? new Date(r.resolved_at).toLocaleString("ja-JP")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
