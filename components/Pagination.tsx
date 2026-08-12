import Link from "next/link";
import { filtersToSearchParams, type BuildingFilters } from "@/lib/buildings/filters";

export function Pagination({
  filters,
  page,
  pageCount,
  total,
}: {
  filters: BuildingFilters;
  page: number;
  pageCount: number;
  total: number;
}) {
  const link = (p: number) =>
    `/buildings?${filtersToSearchParams({ ...filters, page: p }).toString()}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-[var(--text-muted)]">
        全 {total.toLocaleString("ja-JP")} 件中 {page} / {pageCount} ページ
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className="btn">
            前へ
          </Link>
        ) : (
          <span className="btn opacity-50">前へ</span>
        )}
        {page < pageCount ? (
          <Link href={link(page + 1)} className="btn">
            次へ
          </Link>
        ) : (
          <span className="btn opacity-50">次へ</span>
        )}
      </div>
    </div>
  );
}
