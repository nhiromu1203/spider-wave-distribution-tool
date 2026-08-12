import Link from "next/link";
import type { StatusCounts } from "@/lib/buildings/queries";
import { filtersToSearchParams, type BuildingFilters } from "@/lib/buildings/filters";
import type { BuildingStatus } from "@/lib/supabase/types";

const CARDS: Array<{
  status: BuildingStatus;
  label: string;
  className: string;
}> = [
  {
    status: "NOT_DISTRIBUTED",
    label: "配布対象",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  {
    status: "CONFIRMED_DISTRIBUTED",
    label: "配布済み",
    className: "border-slate-200 bg-slate-50 text-slate-800",
  },
  {
    status: "POSSIBLE_DUPLICATE",
    label: "重複候補",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
];

/** 画面上部の件数表示。各数字をクリックすると該当する一覧に切り替わる。 */
export function DashboardCounts({
  counts,
  filters,
}: {
  counts: StatusCounts;
  filters: BuildingFilters;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-[var(--text-muted)]">
        現在のデータベース内の件数（上の絞り込み条件に一致するもの）。
        取得のたびに増える累計であり、1 回の取得件数とは一致しません。
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {CARDS.map((card) => {
        const params = filtersToSearchParams({
          ...filters,
          statuses: [card.status],
          page: 1,
        });
        const isActive =
          filters.statuses.length === 1 && filters.statuses[0] === card.status;

        return (
          <Link
            key={card.status}
            href={`/buildings?${params.toString()}`}
            className={`rounded-lg border px-4 py-3 transition ${card.className} ${
              isActive ? "ring-2 ring-[var(--accent)]" : "hover:brightness-98"
            }`}
          >
            <div className="text-xs font-medium">現在の{card.label}</div>
            <div className="text-2xl font-bold tabular-nums">
              {counts[card.status].toLocaleString("ja-JP")}
              <span className="ml-1 text-sm font-normal">件</span>
            </div>
          </Link>
        );
        })}
      </div>
    </div>
  );
}
