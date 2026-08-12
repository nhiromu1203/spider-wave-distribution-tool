"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncAreaBuildings, type AreaSyncResult } from "@/lib/buildings/sync";

/**
 * 選択されたエリアの建物一覧を取得元から読み込む。
 *
 * まだ一度も取り込んでいないエリアを選んだ場合は自動で取得する
 * （ユーザーはエリアを選ぶだけで一覧が表示される）。
 * 取得済みエリアでは自動実行せず、再取得ボタンだけを出す。
 */
export function AreaSync({
  prefecture,
  city,
  town,
  syncedBuildingCount,
  sourceLabel,
  sourceUnavailableReason,
  selectedSourceId,
}: {
  prefecture: string | null;
  city: string | null;
  town: string | null;
  syncedBuildingCount: number;
  sourceLabel: string | null;
  sourceUnavailableReason: string | null;
  selectedSourceId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AreaSyncResult | null>(null);
  // 同じエリアに対して自動取得を二重実行しないための番人
  const autoLoadedRef = useRef<string | null>(null);

  const run = useCallback(() => {
    if (!prefecture || !city) return;
    startTransition(async () => {
      const r = await syncAreaBuildings({ prefecture, city, town });
      setResult(r);
      if (r.ok) router.refresh();
    });
  }, [prefecture, city, town, router]);

  useEffect(() => {
    if (!prefecture || !city) return;
    if (sourceUnavailableReason) return;
    if (syncedBuildingCount > 0) return;

    const key = `${prefecture}/${city}`;
    if (autoLoadedRef.current === key) return;
    autoLoadedRef.current = key;
    run();
  }, [prefecture, city, syncedBuildingCount, sourceUnavailableReason, run]);

  // 取得元が使えないことは、エリア選択の有無より先に伝える。
  // 代わりの取得元へ勝手に切り替えないため、ここで手を止めてもらう。
  if (sourceUnavailableReason) {
    return (
      <div className="card border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">建物データの取得元が利用できません</p>
        <p className="mt-1">{sourceUnavailableReason}</p>
        <p className="mt-2 text-xs">
          現在の設定：<code>BUILDING_DATA_SOURCE={selectedSourceId}</code>
          {sourceLabel && `（${sourceLabel}）`}
        </p>
        <p className="mt-1 text-xs">
          取得元が使えないあいだ、別のデータへ自動的に切り替えることはしません。
          既に取り込み済みの建物は、そのまま一覧に表示されます。
        </p>
      </div>
    );
  }

  if (!prefecture || !city) {
    return (
      <div className="card border-[var(--accent)] bg-blue-50 p-3 text-sm">
        上の <strong>対象エリア</strong> から都道府県と市区町村を選択してください。
        選択した区の建物一覧が自動で表示されます。
      </div>
    );
  }

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
      <span>
        対象エリア：<strong>{prefecture} {city}</strong>
        {town && ` ${town}`}
      </span>

      {sourceLabel && (
        <span className="text-xs text-[var(--text-muted)]">取得元：{sourceLabel}</span>
      )}

      <button type="button" className="btn" onClick={run} disabled={pending}>
        {pending ? "取得中…" : "建物データを再取得"}
      </button>

      {pending && syncedBuildingCount === 0 && (
        <span className="text-[var(--text-muted)]">
          {city} の建物一覧を読み込んでいます…
        </span>
      )}

      {result && result.notes.length > 0 && (
        <details className="w-full text-xs text-[var(--text-muted)]">
          <summary className="cursor-pointer">
            今回の取得の内訳を見る（データベース全体の件数は上部を参照）
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {result.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      )}

      {result && (
        <span className={result.ok ? "text-[var(--text-muted)]" : "text-red-700"}>
          {result.message}
          {result.ok && (
            <>
              {" "}今回取得した配布対象 {result.available} 件
              {result.alreadyDistributed > 0 &&
                ` / 今回配布済みのため除外 ${result.alreadyDistributed} 件`}
              {result.possibleDuplicate > 0 &&
                ` / 重複候補 ${result.possibleDuplicate} 件`}
              {result.excludedUse > 0 &&
                ` / 対象外用途のため除外 ${result.excludedUse} 件`}
              {result.excludedAsUnknownUse > 0 &&
                `（うち用途不明 ${result.excludedAsUnknownUse} 件）`}
            </>
          )}
        </span>
      )}
    </div>
  );
}
