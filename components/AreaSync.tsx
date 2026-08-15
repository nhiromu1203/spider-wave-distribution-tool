"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncAreaBuildings, type AreaSyncResult } from "@/lib/buildings/sync";

/**
 * 選択されたエリアの建物一覧を取得元から読み込む。
 *
 * ── 自動取得はしない ────────────────────────────────────────
 * 以前は「取り込み済みが 0 件なら自動で取得する」作りだった。
 * 建物マスタを CSV で作り直すと取得元由来は 0 件のままになるため、
 * 画面を開くたびに取得・登録され、建物が際限なく増えた。
 *
 * 建物マスタの正は CSV。ここでは何もせず、明示的に許可された
 * ときだけ手動の取得ボタンを出す。
 * ────────────────────────────────────────────────────────────
 */
export function AreaSync({
  prefecture,
  city,
  town,
  syncedBuildingCount,
  sourceLabel,
  sourceUnavailableReason,
  selectedSourceId,
  syncEnabled,
}: {
  prefecture: string | null;
  city: string | null;
  town: string | null;
  syncedBuildingCount: number;
  sourceLabel: string | null;
  sourceUnavailableReason: string | null;
  selectedSourceId: string;
  /** 取得元からの登録が許可されているか（既定は不許可） */
  syncEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AreaSyncResult | null>(null);
  /** 分割取得の進み具合（区画 n / 全 m） */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  /**
   * 区全体を取り込む。
   *
   * 広い区は 1 リクエストの実行時間に収まらないため、サーバー側が
   * 区画に分けて返す。ここでは終わるまで区画を順に呼び出す。
   * 直列に呼ぶことで、Overpass API へ同時に負荷をかけない。
   */
  const run = useCallback(() => {
    if (!prefecture || !city) return;
    startTransition(async () => {
      let chunkIndex: number | null = 0;
      const totals = { available: 0, alreadyDistributed: 0, possibleDuplicate: 0 };

      while (chunkIndex !== null) {
        const r: AreaSyncResult = await syncAreaBuildings({
          prefecture,
          city,
          town,
          chunkIndex,
        });

        totals.available += r.available;
        totals.alreadyDistributed += r.alreadyDistributed;
        totals.possibleDuplicate += r.possibleDuplicate;

        // 途中経過を都度見せる。累計は集計した値に差し替える。
        setResult({ ...r, ...totals });
        setProgress({
          done: r.progress.chunkIndex + 1,
          total: r.progress.chunkTotal,
        });

        // 失敗したらそこで止める。次の区画へ進むと原因が埋もれるため。
        if (!r.ok) break;

        chunkIndex = r.progress.nextChunkIndex;
        // 区画がひとつ終わるごとに一覧へ反映する
        router.refresh();
      }
    });
  }, [prefecture, city, town, router]);


  // 取得元が使えないことは、エリア選択の有無より先に伝える。
  // 代わりの取得元へ勝手に切り替えないため、ここで手を止めてもらう。
  if (syncEnabled && sourceUnavailableReason) {
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
        選択した区の建物一覧が表示されます。
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

      {syncEnabled ? (
        <button type="button" className="btn" onClick={run} disabled={pending}>
          {pending ? "取得中…" : "建物データを再取得"}
        </button>
      ) : (
        <span className="text-xs text-[var(--text-muted)]">
          建物マスタは CSV 取込で管理しています。取得元からの自動登録は停止中です。
        </span>
      )}

      {pending && (
        <span className="text-[var(--text-muted)]">
          {progress && progress.total > 1
            ? `${city} を ${progress.total} 区画に分けて取得しています（${progress.done}/${progress.total} 完了）…`
            : `${city} の建物一覧を読み込んでいます…`}
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
