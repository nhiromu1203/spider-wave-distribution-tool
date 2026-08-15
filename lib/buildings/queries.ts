import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listSupportedAreas } from "@/lib/data-sources";
import {
  findPrefectureByCity,
  listCities,
  listPrefectures,
} from "@/lib/data-sources/areas";
import type {
  BuildingListRow,
  BuildingStatus,
  DistributionHistoryRow,
  BuildingRow,
} from "@/lib/supabase/types";
import { PAGE_SIZE, type BuildingFilters } from "./filters";

/**
 * Supabase の query builder はメソッドチェーンで型が変わるため、
 * 使用するメソッドだけを構造的に受け取る最小インターフェースを定義する。
 */
type Filterable = {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  gte(column: string, value: unknown): Filterable;
  or(filter: string): Filterable;
  not(column: string, operator: string, value: unknown): Filterable;
};

type Sortable = {
  order(
    column: string,
    options: { ascending: boolean; nullsFirst?: boolean },
  ): Sortable;
};

/**
 * 一覧・件数で共通して使う絞り込み。
 * ステータス条件だけは呼び出し側で差し替える。
 */
/**
 * OR 条件のグループを 1 本の or パラメータにまとめる。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * supabase-js の .or() は呼ぶたびに or= を URL へ追加する。
 * 複数回呼ぶと ?or=(A)&or=(B) となり、PostgREST は同名パラメータの
 * 片方しか解釈しないため、条件が黙って消える。
 *
 * 実際にこれで「prefecture が NULL の配布済み 3 件」が集計から漏れた。
 *
 * ── 解決 ────────────────────────────────────────────────────
 * 各グループの直積を取り、or=(and(...),and(...)) の形にして 1 本にする。
 * PostgREST は or の中に and を入れ子にできる。
 *   (A1 or A2) and (B1 or B2)
 *     → or=(and(A1,B1),and(A1,B2),and(A2,B1),and(A2,B2))
 */
export function combineOrGroups(groups: string[][]): string | null {
  const valid = groups.filter((g) => g.length > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0].join(",");

  let combinations: string[][] = [[]];
  for (const group of valid) {
    combinations = combinations.flatMap((current) =>
      group.map((term) => [...current, term]),
    );
  }
  return combinations.map((terms) => `and(${terms.join(",")})`).join(",");
}

export function applyCommonFilters<T>(query: T, filters: BuildingFilters): T {
  let q = query as Filterable;

  // OR が必要な条件はここに集め、最後に 1 本の or へまとめる
  const orGroups: string[][] = [];

  // ── エリア ──────────────────────────────────────────────
  // 過去配布リストの住所は「荒川区東日暮里3-12」のように都道府県を省略して
  // いることが多く、その場合 prefecture は NULL になる。
  // 市区町村名から都道府県が一意に定まるなら、prefecture は冗長な条件なので
  // 外す。こうすると NULL の行も落とさずに済み、他都道府県も混ざらない。
  if (filters.prefecture) {
    const resolvedByCity = filters.city ? findPrefectureByCity(filters.city) : null;
    const cityIdentifiesPrefecture = resolvedByCity === filters.prefecture;

    if (!cityIdentifiesPrefecture) {
      // 市区町村名が複数の都道府県に存在する場合は厳密に絞る
      q = q.eq("prefecture", filters.prefecture);
    }
  }
  if (filters.city) q = q.eq("city", filters.city);
  if (filters.town) q = q.eq("town", filters.town);

  // ── キーワード ──────────────────────────────────────────
  if (filters.keyword) {
    const escaped = filters.keyword.replace(/[%,()]/g, " ");
    orGroups.push([
      `building_name.ilike.%${escaped}%`,
      `address.ilike.%${escaped}%`,
      `normalized_address.ilike.%${escaped}%`,
    ]);
  }

  // ── 世帯数 ──────────────────────────────────────────────
  // 総世帯数の自動取得が未実装のため、世帯数不明（NULL）は除外しない。
  // 値が入っている物件のみ minUnits 未満を落とす（現状 1〜5 世帯だけが非表示）。
  if (filters.minUnits > 0) {
    if (filters.includeUnknownUnits) {
      orGroups.push([
        `total_units.gte.${filters.minUnits}`,
        "total_units.is.null",
      ]);
    } else {
      q = q.gte("total_units", filters.minUnits);
    }
  } else if (!filters.includeUnknownUnits) {
    q = q.not("total_units", "is", null);
  }

  if (filters.propertyTypes.length < 3) {
    q = q.in("property_type", filters.propertyTypes);
  }

  const combined = combineOrGroups(orGroups);
  if (combined) q = q.or(combined);

  return q as T;
}

function applySort<T>(query: T, sort: BuildingFilters["sort"]): T {
  const q = query as Sortable;

  switch (sort) {
    case "address_desc":
      return q
        .order("normalized_address", { ascending: false })
        .order("building_name", { ascending: false }) as T;
    case "name_asc":
      // 建物名が不明な行は名前が同じなので、住所で安定した順序にする
      return q
        .order("building_name", { ascending: true })
        .order("normalized_address", { ascending: true }) as T;
    case "name_desc":
      return q
        .order("building_name", { ascending: false })
        .order("normalized_address", { ascending: true }) as T;
    case "units_desc":
      // 世帯数不明（NULL）は末尾へ
      return q
        .order("total_units", { ascending: false, nullsFirst: false })
        .order("normalized_address", { ascending: true }) as T;
    case "units_asc":
      return q
        .order("total_units", { ascending: true, nullsFirst: false })
        .order("normalized_address", { ascending: true }) as T;
    case "address_asc":
    default:
      return q
        .order("normalized_address", { ascending: true })
        .order("building_name", { ascending: true }) as T;
  }
}

export type BuildingListResult = {
  rows: BuildingListRow[];
  total: number;
  page: number;
  pageCount: number;
};

export async function fetchBuildings(
  filters: BuildingFilters,
): Promise<BuildingListResult> {
  const supabase = await createClient();

  // ── 表示元は public.buildings ────────────────────────────
  // 以前はビュー（building_list_view）を経由していたが、ビューは
  // 作成時点の列構成で固定されるため、列を足すたびに実体とずれる。
  // 一覧は実体テーブルだけを見て、重複候補の件数は別に数える。
  let query = supabase
    .from("buildings")
    .select("*", { count: "exact" })
    .in("status", filters.statuses);

  query = applyCommonFilters(query, filters);
  query = applySort(query, filters.sort);

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) throw new Error(`建物一覧の取得に失敗しました: ${error.message}`);

  const total = count ?? 0;
  const rows = await withPendingDuplicateCounts(
    supabase,
    (data ?? []) as BuildingRow[],
  );

  // ── 一時的な診断（ダッシュボードとの件数差を追うため）──────
  // 同じ条件で数えているはずの 2 つが食い違ったら、ここで気づけるようにする。
  if (process.env.DEBUG_BUILDING_COUNTS === "1") {
    console.log(
      "[fetchBuildings] 一覧の件数:",
      JSON.stringify(
        {
          参照先: "buildings",
          ステータス条件: filters.statuses,
          エリア: {
            prefecture: filters.prefecture,
            city: filters.city,
            town: filters.town,
          },
          世帯数: {
            minUnits: filters.minUnits,
            不明を含む: filters.includeUnknownUnits,
          },
          種別: filters.propertyTypes,
          キーワード: filters.keyword,
          総件数: total,
          このページの行数: (data ?? []).length,
        },
        null,
        2,
      ),
    );
  }

  return {
    rows,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type StatusCounts = Record<BuildingStatus, number>;

/**
 * ダッシュボード上部の件数。
 *
 * 一覧（fetchBuildings）と数字が食い違わないよう、
 *   ・参照先        building_list_view
 *   ・ステータス条件 .in("status", [...])
 *   ・絞り込み       applyCommonFilters
 * をすべて一覧と同一にしてある。片方だけ buildings テーブルを見ると、
 * 同じ条件のつもりでも件数がずれる。
 */
export async function fetchStatusCounts(
  filters: BuildingFilters,
): Promise<StatusCounts> {
  const supabase = await createClient();
  const statuses: BuildingStatus[] = [
    "NOT_DISTRIBUTED",
    "CONFIRMED_DISTRIBUTED",
    "POSSIBLE_DUPLICATE",
  ];

  const results = await Promise.all(
    statuses.map(async (buildingStatus) => {
      let query = supabase
        .from("buildings")
        .select("id", { count: "exact", head: true })
        .in("status", [buildingStatus]);
      query = applyCommonFilters(query, filters);

      const { count, error, status, statusText } = await query;

      if (error) {
        // head:true は HEAD リクエストになりレスポンス本文が空になる。
        // postgrest-js はそのとき error = { message: "" } しか組み立てられず
        // code / details / hint が付かないため、HTTP ステータスを必ず添える。
        // それでも足りない場合に備え、本文付きで一度だけ投げ直して実エラーを拾う。
        let probeDetail = "";
        try {
          let probe = supabase
            .from("buildings")
            .select("id")
            .in("status", [buildingStatus])
            .limit(1);
          probe = applyCommonFilters(probe, filters);
          const probeResponse = await probe;
          probeDetail = probeResponse.error
            ? [
                probeResponse.error.code,
                probeResponse.error.message,
                probeResponse.error.details,
                probeResponse.error.hint,
              ]
                .filter((v) => typeof v === "string" && v.length > 0)
                .join(" / ")
            : "本文付きの再送は成功（一過性の失敗の可能性）";
        } catch (probeError) {
          probeDetail =
            probeError instanceof Error ? probeError.message : String(probeError);
        }

        const detail =
          [error.message, error.code, error.details, error.hint]
            .filter((v) => typeof v === "string" && v.length > 0)
            .join(" / ") || `HTTP ${status} ${statusText}`;

        throw new Error(
          `件数の集計に失敗しました (${buildingStatus}): ${detail}${
            probeDetail ? ` ／ 詳細: ${probeDetail}` : ""
          }`,
        );
      }
      if (process.env.DEBUG_BUILDING_COUNTS === "1") {
        console.log(
          `[fetchStatusCounts] ${buildingStatus}: ${count ?? 0} 件（参照先 building_list_view / 条件は一覧と同一）`,
        );
      }
      return [buildingStatus, count ?? 0] as const;
    }),
  );

  return Object.fromEntries(results) as StatusCounts;
}

/**
 * エリア選択プルダウンの選択肢。
 *
 * DB に既に取り込まれているエリアだけでなく、建物データ取得元が対応している
 * エリアも併せて出す。そうしないと、まだ一度も取り込んでいない区を
 * ユーザーが選べなくなるため。
 */
export type AreaOptions = {
  prefectures: string[];
  cities: string[];
  towns: string[];
};

export async function fetchAreaOptions(
  prefecture: string | null,
  city: string | null,
): Promise<AreaOptions> {
  const supabase = await createClient();
  const supported = listSupportedAreas();

  const distinct = async (
    column: "prefecture" | "city" | "town",
    eqs: Partial<Record<"prefecture" | "city", string | null>>,
  ) => {
    let q = supabase.from("buildings").select(column).not(column, "is", null);
    for (const [k, v] of Object.entries(eqs)) {
      if (v) q = q.eq(k, v);
    }
    const { data, error } = await q.limit(5000);
    if (error) return [];
    const values = new Set<string>();
    for (const row of data ?? []) {
      const v = (row as Record<string, unknown>)[column];
      if (typeof v === "string" && v) values.add(v);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ja"));
  };

  const [dbPrefectures, dbCities, dbTowns] = await Promise.all([
    distinct("prefecture", {}),
    prefecture ? distinct("city", { prefecture }) : Promise.resolve([]),
    city ? distinct("town", { prefecture, city }) : Promise.resolve([]),
  ]);

  const merge = (a: string[], b: string[], c: string[] = []) =>
    [...new Set([...a, ...b, ...c])].sort((x, y) => x.localeCompare(y, "ja"));

  // 行政区域マスタを土台にする。取得元が未対応の区も選択肢には出し、
  // 選ばれた時点で「この取得元は未対応」と画面に表示する。
  return {
    prefectures: merge(dbPrefectures, listPrefectures(), supported.map((a) => a.prefecture)),
    cities: merge(
      dbCities,
      listCities(prefecture),
      supported.filter((a) => a.prefecture === prefecture).map((a) => a.city),
    ),
    towns: merge(
      dbTowns,
      supported
        .filter((a) => a.prefecture === prefecture && a.city === city)
        .flatMap((a) => a.towns),
    ),
  };
}

/**
 * そのエリアの建物一覧を建物データソースから取得済みかどうか。
 *
 * 過去配布リスト（source = 'import'）由来の行は「エリアの建物一覧を取得した」
 * 証拠にはならないため、必ず source = 'data_source' の行だけを数える。
 * ここを取り違えると、過去配布リストを先に取り込んだエリアで
 * 建物一覧の自動取得がスキップされ、一覧が 0 件のままになる。
 */
export async function countSyncedBuildingsInArea(
  prefecture: string | null,
  city: string | null,
): Promise<number> {
  if (!prefecture || !city) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("buildings")
    .select("id", { count: "exact", head: true })
    .eq("city", city)
    .eq("source", "data_source");

  if (error) return 0;
  return count ?? 0;
}

/** 1 物件の配布履歴（最終配布日・配布回数・担当者・備考） */
export async function fetchDistributionHistory(
  buildingId: string,
): Promise<DistributionHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("distribution_history")
    .select("*")
    .eq("building_id", buildingId)
    .order("distributed_date", { ascending: false });

  if (error) throw new Error(`配布履歴の取得に失敗しました: ${error.message}`);
  return (data ?? []) as DistributionHistoryRow[];
}

export async function fetchBuildingById(
  id: string,
): Promise<BuildingListRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`建物の取得に失敗しました: ${error.message}`);
  if (!data) return null;

  const [row] = await withPendingDuplicateCounts(supabase, [data as BuildingRow]);
  return row ?? null;
}

/**
 * 建物に「確認待ちの重複候補が何件あるか」を添える。
 *
 * 以前はビューの中で数えていたが、一覧の表示元を実体テーブルに
 * 戻したため、ここで別に数えて合成する。重複候補が 0 件でも
 * 建物は必ず一覧に出す（表示から漏らさない）。
 */
async function withPendingDuplicateCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: BuildingRow[],
): Promise<BuildingListRow[]> {
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();

  // 件数取得に失敗しても一覧は表示する。バッジが出ないだけに留める。
  try {
    const { data } = await supabase
      .from("duplicate_candidates")
      .select("new_building_id")
      .eq("status", "pending")
      .in(
        "new_building_id",
        rows.map((r) => r.id),
      );

    for (const d of (data ?? []) as Array<{ new_building_id: string }>) {
      counts.set(
        d.new_building_id,
        (counts.get(d.new_building_id) ?? 0) + 1,
      );
    }
  } catch {
    // バッジ無しで表示を続ける
  }

  return rows.map((row) => ({
    ...row,
    pending_duplicate_count: counts.get(row.id) ?? 0,
  }));
}
