"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DatasetMeta = {
  id: string;
  fileName: string;
  encoding: string;
  buildingCount: number;
  skippedRows: number;
  uploadedAt: string;
  areas: Array<{ prefecture: string; city: string; count: number }>;
};

type UploadResult = {
  dataset: DatasetMeta;
  encoding: string;
  headers: string[];
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  skippedSamples: Array<{ row: number; reason: string }>;
  maxRows: number;
};

const ENCODING_LABEL: Record<string, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8（BOM あり）",
  shift_jis: "Shift_JIS",
};

/**
 * 建物一覧 CSV のアップロード。
 * ドラッグ&ドロップとファイル選択の両方に対応する。
 */
export function BuildingCsvUploader({
  datasets: initialDatasets,
}: {
  datasets: DatasetMeta[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [datasets, setDatasets] = useState(initialDatasets);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setUploading(true);

      try {
        const body = new FormData();
        body.append("file", file);

        const response = await fetch("/api/building-csv", { method: "POST", body });
        const payload = await response.json();

        if (!response.ok) {
          setError(payload.error ?? "取り込みに失敗しました。");
          return;
        }

        setResult(payload as UploadResult);
        setDatasets((prev) => [
          payload.dataset,
          ...prev.filter((d) => d.id !== payload.dataset.id),
        ]);
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error
            ? `アップロードに失敗しました: ${e.message}`
            : "アップロードに失敗しました。",
        );
      } finally {
        setUploading(false);
      }
    },
    [router],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition ${
          dragging
            ? "border-[var(--accent)] bg-blue-50"
            : "border-[var(--border)] bg-white hover:bg-slate-50"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="font-medium">
          {uploading
            ? "読み込み中…"
            : "建物一覧 CSV をここにドラッグ&ドロップ"}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          クリックしてファイルを選ぶこともできます／UTF-8（BOM 有無）・Shift_JIS 対応／最大10万行
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        標準の列は <code>建物名 / 住所 / 総戸数 / 種別 / 緯度 / 経度</code> です。
        住所以外の列は無くても取り込めます（その項目は「不明」になります）。
      </p>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">
            {result.dataset.fileName} を取り込みました
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>
              文字コード：{ENCODING_LABEL[result.encoding] ?? result.encoding}
            </li>
            <li>
              読み込み {result.importedRows.toLocaleString("ja-JP")} 件 / 全{" "}
              {result.totalRows.toLocaleString("ja-JP")} 行
              {result.skippedRows > 0 &&
                `（住所が無いなどで ${result.skippedRows.toLocaleString("ja-JP")} 行を除外）`}
            </li>
            <li>検出した列：{result.headers.join(" / ")}</li>
          </ul>
          {result.skippedSamples.length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer">除外した行の例</summary>
              <ul className="mt-1 list-disc pl-5">
                {result.skippedSamples.map((s) => (
                  <li key={s.row}>
                    {s.row} 行目：{s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-2 text-xs">
            建物一覧画面でエリアを選ぶと、この CSV から建物が取得されます
            （<code>BUILDING_DATA_SOURCE=csv</code> のとき）。
          </p>
        </div>
      )}

      {datasets.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">登録済みデータセット</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="table-cell">ファイル名</th>
                  <th className="table-cell w-28">件数</th>
                  <th className="table-cell w-32">文字コード</th>
                  <th className="table-cell">含まれるエリア</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id}>
                    <td className="table-cell">{d.fileName}</td>
                    <td className="table-cell tabular-nums">
                      {d.buildingCount.toLocaleString("ja-JP")}
                    </td>
                    <td className="table-cell">
                      {ENCODING_LABEL[d.encoding] ?? d.encoding}
                    </td>
                    <td className="table-cell text-[var(--text-muted)]">
                      {d.areas.length === 0
                        ? "—"
                        : d.areas
                            .slice(0, 5)
                            .map((a) => `${a.city}(${a.count})`)
                            .join("、")}
                      {d.areas.length > 5 && ` ほか${d.areas.length - 5}件`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
