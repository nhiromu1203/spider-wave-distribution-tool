"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyAiCsv,
  buildTemplateCsv,
  previewAiCsv,
  rollbackAiCsvBatch,
  type PreviewResult,
} from "@/lib/ai-csv/actions";
import { PROPERTY_TYPE_LABELS, type PlannedRow } from "@/lib/ai-csv/plan";

/** 判定ごとの見た目 */
const VERDICT_STYLE: Record<string, string> = {
  更新可能: "text-emerald-700",
  建物名競合: "text-amber-700",
  住所競合: "text-amber-700",
  要確認: "text-amber-700",
  照合不可: "text-red-700",
  変更なし: "text-[var(--text-muted)]",
};

function download(content: string, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function fieldValue(row: PlannedRow, field: string): [string, string] | null {
  const change = row.changes.find((c) => c.field === field);
  if (!change) return null;
  const label = (v: string | null) =>
    field === "property_type" ? (PROPERTY_TYPE_LABELS[v ?? ""] ?? v ?? "—") : (v ?? "—");
  return [label(change.oldValue), label(change.newValue)];
}

/**
 * ChatGPT 等で調べた建物情報を取り込む。
 *
 * アップロードしただけでは何も変わらない。内容を確認し、
 * 反映する行を選んでから初めて DB を更新する。
 */
export function AiResearchCsvPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = preview?.plan.rows ?? [];
  const updatableLines = useMemo(
    () => rows.filter((r) => r.verdict === "更新可能").map((r) => r.line),
    [rows],
  );

  const read = useCallback(
    (file: File, overwriteExisting: boolean) => {
    startTransition(async () => {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
      const result = await previewAiCsv(text, { overwriteExisting });
      setPreview(result);
      setMessage(result.message);
      // 競合・要確認は既定で選ばない
      setSelected(
        new Set(
          result.plan.rows.filter((r) => r.verdict === "更新可能").map((r) => r.line),
        ),
      );
    });
    },
    [],
  );

  const toggle = (line: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const apply = useCallback(() => {
    if (!csvText) return;
    startTransition(async () => {
      const result = await applyAiCsv(csvText, [...selected], fileName, {
        overwriteExisting: overwrite,
      });
      setMessage(result.message);
      setLastBatch(result.batchId);
      setPreview(null);
      setCsvText(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }, [csvText, selected, fileName, overwrite, router]);

  const rollback = useCallback(() => {
    if (!lastBatch) return;
    startTransition(async () => {
      const result = await rollbackAiCsvBatch(lastBatch);
      setMessage(result.message);
      setLastBatch(null);
      router.refresh();
    });
  }, [lastBatch, router]);

  const counts = preview?.plan.counts;

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-semibold">AI 調査 CSV 取込</h2>
        <p className="text-sm text-[var(--text-muted)]">
          ChatGPT 等で調査した建物名・詳細住所・総世帯数等を既存建物へ反映します。
          アップロードしただけでは変更されません。内容を確認し、反映する行を選んでから実行してください。
          配布履歴・配布済み判定・重複候補には一切影響しません。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () =>
              download(await buildTemplateCsv(), "AI調査用テンプレート.csv"),
            )
          }
        >
          AI調査用CSVテンプレートをダウンロード
        </button>

        <label className="btn cursor-pointer">
          CSV を選択
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) read(file, overwrite);
            }}
          />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={overwrite}
          disabled={pending}
          onChange={(e) => {
            setOverwrite(e.target.checked);
            // 判断が変わるため、読み込み済みの内容は破棄して選び直してもらう
            setPreview(null);
            setCsvText(null);
            setSelected(new Set());
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <span>
          既存値も CSV で上書きする
          <span className="block text-xs text-[var(--text-muted)]">
            対象は建物名・総世帯数・所有形態・建物種別のみです。住所は「より詳細になった場合」の規則のままで、
            配布履歴・配布済み判定・座標・担当者は変更しません。
          </span>
        </span>
      </label>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) read(file, overwrite);
        }}
        className="rounded-sm border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]"
      >
        CSV をここにドラッグ＆ドロップもできます。
      </div>

      {message && <p className="text-sm">{message}</p>}

      {lastBatch && (
        <div className="flex items-center gap-2 text-sm">
          <span>直前の取込を取り消せます（建物情報のみ）。</span>
          <button type="button" className="btn" onClick={rollback} disabled={pending}>
            この取込を元に戻す
          </button>
        </div>
      )}

      {preview && counts && (
        <div className="space-y-2">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <li>CSV 総件数 <strong>{counts.total}</strong></li>
            <li className="text-emerald-700">更新可能 <strong>{counts.updatable}</strong></li>
            <li className="text-amber-700">要確認 {counts.needsReview}</li>
            <li className="text-red-700">照合不可 {counts.unmatched}</li>
            <li>変更なし {counts.noChange}</li>
            <li className={counts.error > 0 ? "text-red-700" : ""}>
              エラー {counts.error}
            </li>
          </ul>

          {preview.plan.errors.length > 0 && (
            <div className="rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-800">
              <ul className="list-disc pl-5">
                {preview.plan.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    {e.line > 0 ? `${e.line} 行目: ` : ""}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="btn"
              onClick={() => setSelected(new Set(updatableLines))}
              disabled={pending}
            >
              「更新可能」だけ一括選択（{updatableLines.length}件）
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setSelected(new Set())}
              disabled={pending}
            >
              選択を解除
            </button>
          </div>

          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface)]">
                <tr className="text-left">
                  <th className="py-1 pr-2">反映</th>
                  <th className="py-1 pr-3">判定</th>
                  <th className="py-1 pr-3">建物名</th>
                  <th className="py-1 pr-3">住所</th>
                  <th className="py-1 pr-3">総世帯数</th>
                  <th className="py-1 pr-3">所有形態</th>
                  <th className="py-1 pr-3">建物種別</th>
                  <th className="py-1 pr-3">source</th>
                  <th className="py-1">note / 理由</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = fieldValue(row, "building_name");
                  const address = fieldValue(row, "address");
                  const units = fieldValue(row, "total_units");
                  const type = fieldValue(row, "property_type");
                  const kind = fieldValue(row, "building_type");

                  return (
                    <tr key={row.line} className="border-t border-[var(--border)] align-top">
                      <td className="py-1 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.line)}
                          disabled={row.verdict !== "更新可能" || pending}
                          onChange={() => toggle(row.line)}
                        />
                      </td>
                      <td className={`py-1 pr-3 ${VERDICT_STYLE[row.verdict] ?? ""}`}>
                        {row.verdict}
                      </td>
                      <td className="py-1 pr-3">
                        {name ? (
                          <>
                            <span className="text-[var(--text-muted)]">
                              {name[0] || "（未設定）"}
                            </span>
                            {" → "}
                            <strong>{name[1]}</strong>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            {row.matched?.building_name || "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {address ? (
                          <>
                            <span className="text-[var(--text-muted)]">{address[0]}</span>
                            {" → "}
                            <strong>{address[1]}</strong>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            {row.matched?.address ?? row.csv.address}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {units ? (
                          <>
                            <span className="text-[var(--text-muted)]">{units[0]}</span>
                            {" → "}
                            <strong>{units[1]}</strong>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            {row.matched?.total_units ?? "不明"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {type ? (
                          <>
                            <span className="text-[var(--text-muted)]">{type[0]}</span>
                            {" → "}
                            <strong>{type[1]}</strong>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            {PROPERTY_TYPE_LABELS[row.matched?.property_type ?? ""] ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {kind ? (
                          <>
                            <span className="text-[var(--text-muted)]">{kind[0]}</span>
                            {" → "}
                            <strong>{kind[1]}</strong>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            {row.matched?.building_type ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">{row.csv.source}</td>
                      <td className="py-1 text-[var(--text-muted)]">
                        {[row.csv.note, ...row.reasons].filter(Boolean).join(" / ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn"
            onClick={apply}
            disabled={pending || selected.size === 0}
          >
            選択した {selected.size} 件を反映
          </button>
        </div>
      )}
    </section>
  );
}
