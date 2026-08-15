"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyNameCsv,
  exportUnknownNameCsv,
  previewNameCsv,
  type PreviewResult,
} from "@/lib/building-names/csv-actions";

/**
 * 建物名を CSV でやり取りする。
 *
 * 書き出した CSV を別途調べてもらい、建物名と確度を書き足して戻す。
 * 取り込みは必ず確認画面を挟み、押されたときだけ反映する。
 */
export function NameCsvPanel({
  prefecture,
  city,
}: {
  prefecture: string | null;
  city: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const areaLabel = [prefecture, city].filter(Boolean).join(" ") || "全地域";

  const download = useCallback(() => {
    startTransition(async () => {
      const result = await exportUnknownNameCsv({ prefecture, city });
      setMessage(result.message);
      if (!result.ok || !result.csv) return;

      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName ?? "buildings.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [prefecture, city]);

  const readFile = useCallback((file: File) => {
    startTransition(async () => {
      const text = await file.text();
      setCsvText(text);
      const result = await previewNameCsv(text);
      setPreview(result);
      setMessage(result.message);
    });
  }, []);

  const apply = useCallback(() => {
    if (!csvText) return;
    startTransition(async () => {
      const result = await applyNameCsv(csvText);
      setMessage(result.message);
      setPreview(null);
      setCsvText(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }, [csvText, router]);

  return (
    <div className="card space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold">建物名の補完（CSV）</span>

        <button type="button" className="btn" onClick={download} disabled={pending}>
          建物名不明CSV出力
        </button>
        <span className="text-xs text-[var(--text-muted)]">対象：{areaLabel}</span>

        <label className="btn cursor-pointer">
          建物名補完CSV取込
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </label>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) readFile(file);
        }}
        className="rounded-sm border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]"
      >
        補完済みCSVをここにドラッグ＆ドロップもできます。
        取り込んでもすぐには反映せず、まず内容を表示します。
      </div>

      {message && <p>{message}</p>}

      {preview && (
        <div className="space-y-2">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <li>更新予定 <strong>{preview.counts.update}</strong> 件</li>
            <li>既存名ありでスキップ {preview.counts.existingName} 件</li>
            <li>同名で更新済み {preview.counts.alreadySame} 件</li>
            <li>AMBIGUOUS {preview.counts.ambiguous} 件</li>
            <li>NOT_FOUND {preview.counts.notFound} 件</li>
            <li className={preview.counts.error > 0 ? "text-red-700" : ""}>
              エラー {preview.counts.error} 件
            </li>
          </ul>

          {preview.errors.length > 0 && (
            <div className="rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-800">
              <p className="font-semibold">
                エラーが解消されるまで反映できません。
              </p>
              <ul className="mt-1 list-disc pl-5">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    {e.line > 0 ? `${e.line} 行目: ` : ""}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.updates.length > 0 && (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface)]">
                  <tr className="text-left">
                    <th className="py-1 pr-3">住所</th>
                    <th className="py-1 pr-3">現在の建物名</th>
                    <th className="py-1 pr-3">新しい建物名</th>
                    <th className="py-1 pr-3">status</th>
                    <th className="py-1">source</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.updates.map((u) => (
                    <tr key={u.building_id} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-3">{u.address}</td>
                      <td className="py-1 pr-3 text-[var(--text-muted)]">
                        {u.currentName || "（未設定）"}
                      </td>
                      <td className="py-1 pr-3 font-semibold">{u.newName}</td>
                      <td className="py-1 pr-3">{u.status}</td>
                      <td className="py-1">{u.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="btn"
            onClick={apply}
            disabled={pending || !preview.ok || preview.counts.update === 0}
          >
            {preview.counts.update} 件を反映
          </button>
        </div>
      )}
    </div>
  );
}
