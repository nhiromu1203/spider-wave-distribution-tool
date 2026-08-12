"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { markAsDistributed } from "@/lib/buildings/actions";
import { BuildingNameCell } from "./BuildingNameCell";
import { StatusBadge } from "./StatusBadge";
import { isDevelopmentData } from "@/lib/data-sources/types";
import {
  PROPERTY_TYPE_LABEL,
  type BuildingListRow,
} from "@/lib/supabase/types";

/**
 * Google マップで開く URL。
 * 座標があれば座標を使う（街区レベルの住所より正確に指せるため）。
 */
function googleMapsUrl(row: BuildingListRow): string {
  const query =
    row.latitude !== null && row.longitude !== null
      ? `${row.latitude},${row.longitude}`
      : row.address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BuildingTable({ rows }: { rows: BuildingListRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [distributedDate, setDistributedDate] = useState(today);
  const [distributedBy, setDistributedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    startTransition(async () => {
      const result = await markAsDistributed([...selected], {
        distributedDate,
        distributedBy,
        notes,
      });
      setFeedback(result);
      if (result.ok) {
        setSelected(new Set());
        setDialogOpen(false);
        setNotes("");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0}
          onClick={() => {
            setFeedback(null);
            setDialogOpen(true);
          }}
        >
          配布済みにする
          {selected.size > 0 && `（${selected.size}件）`}
        </button>
        {selected.size > 0 && (
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>
            選択解除
          </button>
        )}
        {feedback && (
          <span
            className={`text-sm ${feedback.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>

      {dialogOpen && (
        <div className="card space-y-3 border-[var(--accent)] p-3">
          <h2 className="font-semibold">
            配布済みとして登録（{selectedRows.length}件）
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="distributedDate">
                配布日 <span className="text-red-600">*</span>
              </label>
              <input
                id="distributedDate"
                type="date"
                className="field"
                value={distributedDate}
                onChange={(e) => setDistributedDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="distributedBy">
                担当者
              </label>
              <input
                id="distributedBy"
                className="field"
                value={distributedBy}
                placeholder="例：山田"
                onChange={(e) => setDistributedBy(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="notes">
                備考
              </label>
              <input
                id="notes"
                className="field"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <details className="text-xs text-[var(--text-muted)]">
            <summary className="cursor-pointer">対象物件を確認する</summary>
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5">
              {selectedRows.map((r) => (
                <li key={r.id}>
                  {r.building_name}（{r.address}）
                </li>
              ))}
            </ul>
          </details>

          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={pending}
            >
              {pending ? "登録中…" : "登録する"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setDialogOpen(false)}
              disabled={pending}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-slate-50 text-left text-xs text-[var(--text-muted)]">
            <tr>
              <th className="table-cell w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="すべて選択"
                />
              </th>
              <th className="table-cell">建物名</th>
              <th className="table-cell">住所</th>
              <th className="table-cell w-24 text-right">総世帯数</th>
              <th className="table-cell w-20">種別</th>
              <th className="table-cell w-28">最終配布日</th>
              <th className="table-cell w-24 text-right">配布回数</th>
              <th className="table-cell w-32">配布状況</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-[var(--text-muted)]">
                  条件に一致する物件がありません。対象エリアを選択すると、その区の建物一覧が表示されます。
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr
                key={row.id}
                className={selected.has(row.id) ? "bg-blue-50" : "hover:bg-slate-50"}
              >
                <td className="table-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={`${row.building_name} を選択`}
                  />
                </td>
                <td className="table-cell font-medium">
                  <BuildingNameCell
                    buildingId={row.id}
                    buildingName={row.building_name}
                  />
                  {isDevelopmentData(row.source_ref) && (
                    <span
                      className="badge ml-2 border border-amber-300 bg-amber-50 font-normal text-amber-800"
                      title="本番の建物データソースが未確定のため用意した開発確認用データです"
                    >
                      開発用データ
                    </span>
                  )}
                  {row.pending_duplicate_count > 0 && (
                    <Link
                      href={`/duplicates?building=${row.id}`}
                      className="ml-2 text-xs text-amber-700 underline"
                    >
                      要確認 {row.pending_duplicate_count}件
                    </Link>
                  )}
                </td>
                <td className="table-cell">
                  <a
                    href={googleMapsUrl(row)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] underline decoration-dotted underline-offset-2"
                    title="Google マップで開く（別タブ）"
                  >
                    {row.address}
                  </a>
                  {row.address_precision === "block" && (
                    <span
                      className="badge ml-2 border border-slate-200 bg-slate-50 font-normal text-slate-600"
                      title="住所は街区符号までです（住居番号は含みません）。地図で位置を確認してください。"
                    >
                      街区まで
                    </span>
                  )}
                </td>
                <td className="table-cell text-right tabular-nums">
                  {row.total_units === null ? (
                    <span className="text-[var(--text-muted)]">不明</span>
                  ) : (
                    row.total_units.toLocaleString("ja-JP")
                  )}
                </td>
                <td className="table-cell">{PROPERTY_TYPE_LABEL[row.property_type]}</td>
                <td className="table-cell tabular-nums">
                  {row.last_distributed_date ?? "—"}
                </td>
                <td className="table-cell text-right tabular-nums">
                  {row.distribution_count}
                </td>
                <td className="table-cell">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
