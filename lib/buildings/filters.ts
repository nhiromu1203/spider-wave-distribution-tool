/**
 * 一覧画面の検索条件。URL のクエリ文字列と 1:1 で対応させ、
 * 絞り込んだ状態をそのまま同僚に共有できるようにする。
 */

import {
  MIN_TOTAL_UNITS_DEFAULT,
  type BuildingStatus,
  type PropertyType,
} from "@/lib/supabase/types";

export type SortKey =
  | "address_asc"
  | "address_desc"
  | "name_asc"
  | "name_desc"
  | "units_desc"
  | "units_asc";

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "address_asc", label: "住所順（昇順）" },
  { value: "address_desc", label: "住所順（降順）" },
  { value: "name_asc", label: "建物名順（昇順）" },
  { value: "name_desc", label: "建物名順（降順）" },
  { value: "units_desc", label: "世帯数が多い順" },
  { value: "units_asc", label: "世帯数が少ない順" },
];

export const PAGE_SIZE = 100;

export type BuildingFilters = {
  prefecture: string | null;
  city: string | null;
  town: string | null;
  keyword: string | null;
  minUnits: number;
  /** 総世帯数が不明な物件も一覧に含めるか（推測はしないため既定で含める） */
  includeUnknownUnits: boolean;
  propertyTypes: PropertyType[];
  statuses: BuildingStatus[];
  sort: SortKey;
  page: number;
};

const ALL_TYPES: PropertyType[] = ["rental", "condominium", "unknown"];
const ALL_STATUSES: BuildingStatus[] = [
  "NOT_DISTRIBUTED",
  "POSSIBLE_DUPLICATE",
  "CONFIRMED_DISTRIBUTED",
];

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

/**
 * 既定値：最低世帯数 6、ステータスは「未配布のみ」。
 */
export function parseFilters(params: RawSearchParams): BuildingFilters {
  const rawMin = first(params.minUnits);
  const parsedMin = rawMin === null ? NaN : Number(rawMin);

  const types = list(params.type).filter((t): t is PropertyType =>
    (ALL_TYPES as string[]).includes(t),
  );
  const statuses = list(params.status).filter((s): s is BuildingStatus =>
    (ALL_STATUSES as string[]).includes(s),
  );

  const sortRaw = first(params.sort);
  const sort = SORT_OPTIONS.some((o) => o.value === sortRaw)
    ? (sortRaw as SortKey)
    : "address_asc";

  const page = Math.max(1, Number(first(params.page)) || 1);

  return {
    prefecture: first(params.prefecture) || null,
    city: first(params.city) || null,
    town: first(params.town) || null,
    keyword: first(params.q)?.trim() || null,
    minUnits:
      Number.isFinite(parsedMin) && parsedMin >= 0
        ? Math.floor(parsedMin)
        : MIN_TOTAL_UNITS_DEFAULT,
    includeUnknownUnits: first(params.unknownUnits) !== "0",
    propertyTypes: types.length > 0 ? types : ALL_TYPES,
    statuses: statuses.length > 0 ? statuses : ["NOT_DISTRIBUTED"],
    sort,
    page,
  };
}

/** フィルタを URL クエリへ戻す */
export function filtersToSearchParams(
  filters: Partial<BuildingFilters>,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.prefecture) sp.set("prefecture", filters.prefecture);
  if (filters.city) sp.set("city", filters.city);
  if (filters.town) sp.set("town", filters.town);
  if (filters.keyword) sp.set("q", filters.keyword);
  if (filters.minUnits !== undefined) sp.set("minUnits", String(filters.minUnits));
  if (filters.includeUnknownUnits === false) sp.set("unknownUnits", "0");
  if (filters.propertyTypes && filters.propertyTypes.length < ALL_TYPES.length) {
    for (const t of filters.propertyTypes) sp.append("type", t);
  }
  if (filters.statuses) {
    for (const s of filters.statuses) sp.append("status", s);
  }
  if (filters.sort) sp.set("sort", filters.sort);
  if (filters.page && filters.page > 1) sp.set("page", String(filters.page));
  return sp;
}
