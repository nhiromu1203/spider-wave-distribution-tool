import { AreaSync } from "@/components/AreaSync";
import { NameCsvPanel } from "@/components/NameCsvPanel";
import { BuildingFilterBar } from "@/components/BuildingFilterBar";
import { BuildingTable } from "@/components/BuildingTable";
import { DashboardCounts } from "@/components/DashboardCounts";
import { Pagination } from "@/components/Pagination";
import { parseFilters, type RawSearchParams } from "@/lib/buildings/filters";
import {
  fetchAreaOptions,
  fetchBuildings,
  fetchStatusCounts,
} from "@/lib/buildings/queries";
import { refreshCsvAreas, resolveBuildingDataSource } from "@/lib/data-sources";
import { isUnitCountAvailable } from "@/lib/data-sources/unit-count";

export const dynamic = "force-dynamic";

/**
 * このページから呼ぶ建物取得（syncAreaBuildings）は、Overpass API の応答待ちと
 * 位置参照情報の初回ダウンロードで時間がかかる。既定の実行時間では足りないため
 * 明示的に伸ばす。
 *
 * 値は Vercel Hobby プランの上限に合わせている。上限を超える値を指定すると
 * デプロイ自体が失敗するため、プランを変更したときはここも見直すこと。
 */
export const maxDuration = 60;

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseFilters(await searchParams);

  // CSV 取得元の対応エリアはファイルから読むため、非同期で先に読み込んでおく
  // （listAreas() は同期メソッドのため）
  await refreshCsvAreas();

  const [counts, areas, list] = await Promise.all([
    fetchStatusCounts(filters),
    fetchAreaOptions(filters.prefecture, filters.city),
    fetchBuildings(filters),
  ]);

  // 取得元の情報は「開発用データが混ざっていないか」の注意書きにだけ使う。
  // 取得そのものはこの画面から行わない。
  const { active } = resolveBuildingDataSource();

  return (
    <div className="space-y-4">
      <DashboardCounts counts={counts} filters={filters} />

      <BuildingFilterBar filters={filters} areas={areas} />

      <AreaSync
        prefecture={filters.prefecture}
        city={filters.city}
        town={filters.town}
      />

      {active?.isDevelopment && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>開発用データ</strong>：本番の建物データソースが未確定のため、
          一覧には「{active.label}」のダミーデータが含まれています。実在の物件情報ではありません。
        </p>
      )}

      {!isUnitCountAvailable() && (
        <p className="text-xs text-[var(--text-muted)]">
          総世帯数の自動取得は未実装のため、現在はすべて「不明」と表示されます（推測値は入れていません）。
          世帯数が取得できない物件も配布対象から除外していません。
        </p>
      )}

      <NameCsvPanel prefecture={filters.prefecture} city={filters.city} />

      <BuildingTable rows={list.rows} />

      <Pagination
        filters={filters}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </div>
  );
}
