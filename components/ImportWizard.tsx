"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FIELD_LABELS,
  guessMapping,
  isExcelFile,
  parseCsvFile,
  parseDate,
  type ColumnMapping,
  type ParsedFile,
  type TargetField,
} from "@/lib/import/parse";
import { previewImport, runImport } from "@/lib/import/actions";
import {
  MAX_IMPORT_ROWS,
  OUTCOME_LABEL,
  type ImportPreview,
} from "@/lib/import/types";
import type { BuildingInput } from "@/lib/buildings/ingest";

/**
 * 過去配布リストで扱う列。
 * 建物名と住所は必須、配布日・担当者・備考は任意。
 */
const FIELDS: TargetField[] = [
  "building_name",
  "address",
  "distributed_date",
  "distributed_by",
  "notes",
];

export function ImportWizard() {
  const router = useRouter();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    setPreview(null);
    setDone(false);
    setFileError(null);
    if (!selected) return;

    if (isExcelFile(selected.name)) {
      setFile(null);
      setFileError(
        "Excel ファイルの直接取込は準備中です。Excel で「CSV UTF-8」形式に書き出して取り込んでください。",
      );
      return;
    }

    try {
      const parsed = await parseCsvFile(selected);
      if (parsed.headers.length === 0) {
        setFileError(
          "ヘッダー行を読み取れませんでした。1行目に列名がある CSV を選んでください。",
        );
        setFile(null);
        return;
      }
      setFile(parsed);
      setMapping(guessMapping(parsed.headers));
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "ファイルを読み込めませんでした。",
      );
      setFile(null);
    }
  };

  /** マッピングを適用して取り込み用の行に変換する */
  const inputs: BuildingInput[] = useMemo(() => {
    if (!file) return [];

    const pick = (row: Record<string, string>, field: TargetField) => {
      const column = mapping[field];
      return column ? (row[column] ?? "") : "";
    };

    return file.rows.map((row) => ({
      building_name: pick(row, "building_name").trim() || "（建物名なし）",
      address: pick(row, "address").trim(),
      distribution: {
        // 配布日が読み取れない場合も取込は止めず、当日として登録する
        distributed_date:
          parseDate(pick(row, "distributed_date")) ??
          new Date().toISOString().slice(0, 10),
        distributed_by: pick(row, "distributed_by").trim() || null,
        notes: pick(row, "notes").trim() || null,
      },
    }));
  }, [file, mapping]);

  const missingAddressColumn = !mapping.address;

  const runPreview = () => {
    startTransition(async () => {
      setDone(false);
      setPreview(await previewImport(inputs));
    });
  };

  const execute = () => {
    startTransition(async () => {
      const result = await runImport(inputs, {
        fileName: file?.fileName ?? "unknown.csv",
        kind: "distributed",
        mapping: mapping as Record<string, string | null>,
      });
      setPreview(result);
      setDone(result.ok);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. ファイル選択 */}
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">1. 過去配布リストを選択</h2>
        <p className="text-sm text-[var(--text-muted)]">
          過去にチラシを配布した物件の一覧を取り込みます。
          配布対象候補の建物一覧はエリア選択時に自動取得されるため、ここでは扱いません。
        </p>

        <div>
          <label className="label" htmlFor="file">
            CSV ファイル（{MAX_IMPORT_ROWS.toLocaleString("ja-JP")}行まで）
          </label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            onChange={onFileChange}
            className="field"
          />
        </div>

        {fileError && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {fileError}
          </p>
        )}

        {file && (
          <p className="text-sm text-[var(--text-muted)]">
            {file.fileName}：{file.rows.length.toLocaleString("ja-JP")} 行 /{" "}
            {file.headers.length} 列を読み込みました。
          </p>
        )}
      </section>

      {/* 2. カラムマッピング */}
      {file && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">2. 列の対応づけ</h2>
          <p className="text-sm text-[var(--text-muted)]">
            元データによって列名が異なるため、どの列をどの項目として扱うか指定してください。
            住所は配布済み判定の最優先キーのため必須です。
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((field) => (
              <div key={field}>
                <label className="label" htmlFor={`map-${field}`}>
                  {FIELD_LABELS[field]}
                  {(field === "address" || field === "building_name") && (
                    <span className="ml-1 text-red-600">*</span>
                  )}
                </label>
                <select
                  id={`map-${field}`}
                  className="field"
                  value={mapping[field] ?? ""}
                  onChange={(e) => {
                    setPreview(null);
                    setMapping((prev) => ({
                      ...prev,
                      [field]: e.target.value || null,
                    }));
                  }}
                >
                  <option value="">（使用しない）</option>
                  {file.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {missingAddressColumn && (
            <p className="text-sm text-red-700">
              住所として使用する列を指定してください。
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs">
              <caption className="mb-1 text-left text-xs text-[var(--text-muted)]">
                変換結果のプレビュー（先頭5行）
              </caption>
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="table-cell">建物名</th>
                  <th className="table-cell">住所</th>
                  <th className="table-cell">配布日</th>
                  <th className="table-cell">担当者</th>
                  <th className="table-cell">備考</th>
                </tr>
              </thead>
              <tbody>
                {inputs.slice(0, 5).map((input, i) => (
                  <tr key={i}>
                    <td className="table-cell">{input.building_name}</td>
                    <td className={`table-cell ${input.address ? "" : "text-red-700"}`}>
                      {input.address || "（住所なし）"}
                    </td>
                    <td className="table-cell">
                      {input.distribution?.distributed_date}
                    </td>
                    <td className="table-cell">
                      {input.distribution?.distributed_by ?? "—"}
                    </td>
                    <td className="table-cell">{input.distribution?.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || missingAddressColumn || inputs.length === 0}
            onClick={runPreview}
          >
            {pending ? "確認中…" : "登録前の内容を確認する"}
          </button>
        </section>
      )}

      {/* 3. 実行前の確認 */}
      {preview && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">3. 登録内容の確認</h2>

          {preview.message && (
            <p
              className={`rounded px-3 py-2 text-sm ${
                preview.ok
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {preview.message}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {(
              [
                ["inserted", "正常（新規登録）"],
                ["merged", "既存物件に配布履歴を追加"],
                ["already_distributed", "配布済みのため除外"],
                ["possible_duplicate", "重複候補"],
                ["skipped", "登録不可（住所不足など）"],
                ["excluded_use", "対象外用途"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="rounded border border-[var(--border)] p-2">
                <div className="text-xs text-[var(--text-muted)]">{label}</div>
                <div className="text-xl font-bold tabular-nums">
                  {preview.counts[key].toLocaleString("ja-JP")}
                </div>
              </div>
            ))}
          </div>

          {preview.samples.length > 0 && (
            <details open className="text-sm">
              <summary className="cursor-pointer">
                判定結果のサンプル（{preview.samples.length}件）
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="table-cell w-48">判定</th>
                      <th className="table-cell">建物名</th>
                      <th className="table-cell">住所</th>
                      <th className="table-cell">理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((s, i) => (
                      <tr key={i}>
                        <td className="table-cell">{OUTCOME_LABEL[s.outcome]}</td>
                        <td className="table-cell">{s.building_name}</td>
                        <td className="table-cell">{s.address || "—"}</td>
                        <td className="table-cell text-[var(--text-muted)]">
                          {s.message ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {done ? (
            <div className="flex flex-wrap gap-2">
              <a href="/buildings" className="btn btn-primary">
                建物一覧を見る
              </a>
              {preview.counts.possible_duplicate > 0 && (
                <a href="/duplicates" className="btn">
                  重複候補を確認する（{preview.counts.possible_duplicate}件）
                </a>
              )}
            </div>
          ) : (
            preview.ok && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={execute}
              >
                {pending ? "登録中…" : "この内容で登録を実行する"}
              </button>
            )
          )}
        </section>
      )}
    </div>
  );
}
