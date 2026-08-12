"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveDuplicate } from "@/lib/buildings/actions";
import type { DuplicateCandidateWithBuildings } from "@/lib/buildings/duplicates";
import { PROPERTY_TYPE_LABEL } from "@/lib/supabase/types";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-b border-[var(--border)] py-1.5 last:border-b-0">
      <dt className="w-24 shrink-0 text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  );
}

export function DuplicateCard({
  candidate,
}: {
  candidate: DuplicateCandidateWithBuildings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const target = candidate.new_building;
  const existing = candidate.existing_building;

  const decide = (decision: "same" | "different") => {
    setError(null);
    startTransition(async () => {
      const result = await resolveDuplicate(candidate.id, decision);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <article className="card p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 新規取得物件 */}
        <section>
          <h3 className="mb-2 inline-block rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            新規取得物件
          </h3>
          <dl className="text-sm">
            <Row label="建物名" value={target?.building_name ?? "—"} />
            <Row label="住所" value={target?.address ?? "—"} />
            <Row
              label="総世帯数"
              value={
                target?.total_units == null ? (
                  <span className="text-[var(--text-muted)]">不明</span>
                ) : (
                  `${target.total_units.toLocaleString("ja-JP")} 世帯`
                )
              }
            />
            <Row
              label="種別"
              value={target ? PROPERTY_TYPE_LABEL[target.property_type] : "—"}
            />
          </dl>
        </section>

        {/* 過去配布候補 */}
        <section>
          <h3 className="mb-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
            過去配布候補
          </h3>
          <dl className="text-sm">
            <Row label="建物名" value={existing?.building_name ?? "—"} />
            <Row label="住所" value={existing?.address ?? "—"} />
            <Row label="配布日" value={existing?.last_distributed_date ?? "—"} />
            <Row label="配布回数" value={`${existing?.distribution_count ?? 0} 回`} />
          </dl>
        </section>
      </div>

      {/* 判定理由 */}
      <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
        <h4 className="mb-1 text-xs font-semibold text-amber-900">重複判定理由</h4>
        <ul className="list-disc pl-5 text-sm text-amber-900">
          {(candidate.reason ?? []).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {candidate.distance_meters != null && (
            <li>座標距離 {Math.round(candidate.distance_meters)}m</li>
          )}
        </ul>
        <p className="mt-1 text-xs text-amber-800">
          住所類似度 {Math.round(Number(candidate.address_similarity_score) * 100)}% ／
          建物名類似度 {Math.round(Number(candidate.name_similarity_score) * 100)}%
        </p>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => decide("same")}
        >
          同じ建物（配布済みにする）
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => decide("different")}
        >
          別の建物（未配布に戻す）
        </button>
        <span className="self-center text-xs text-[var(--text-muted)]">
          一度判断すると、この組み合わせは再び確認画面に表示されません。
        </span>
      </div>
    </article>
  );
}
