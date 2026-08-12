/**
 * DB の型定義。supabase/migrations/0001_init.sql と 1:1 で対応する。
 * スキーマを変更したらこのファイルも更新すること。
 */

export type PropertyType = "rental" | "condominium" | "unknown";

export type BuildingStatus =
  | "NOT_DISTRIBUTED"
  | "POSSIBLE_DUPLICATE"
  | "CONFIRMED_DISTRIBUTED";

export type DuplicateResolution = "pending" | "same" | "different";

export type BuildingSource = "manual" | "import" | "data_source";

/**
 * 建物用途（migration 0002）。配布対象は RESIDENTIAL_MULTI のみ。
 * 対象外の建物は登録されないため、実データはほぼ RESIDENTIAL_MULTI になる。
 */
export type BuildingUseValue = "RESIDENTIAL_MULTI" | "EXCLUDED";

export const BUILDING_USE_LABEL: Record<BuildingUseValue, string> = {
  RESIDENTIAL_MULTI: "集合住宅",
  EXCLUDED: "対象外",
};

export type BuildingRow = {
  id: string;
  building_name: string;
  address: string;
  /** migration 0002 が未適用の環境では undefined になる */
  building_use?: BuildingUseValue;
  building_use_note?: string | null;
  /** migration 0003。住所の出所（source=取得元 / isj=位置参照情報で補完） */
  address_source?: string | null;
  /** migration 0003。住所の粒度（housenumber / block / town） */
  address_precision?: string | null;
  normalized_building_name: string;
  normalized_address: string;
  address_extra: string | null;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  total_units: number | null;
  property_type: PropertyType;
  latitude: number | null;
  longitude: number | null;
  status: BuildingStatus;
  last_distributed_date: string | null;
  distribution_count: number;
  source: BuildingSource;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type BuildingListRow = BuildingRow & {
  pending_duplicate_count: number;
};

export type BuildingInsert = Omit<
  BuildingRow,
  "id" | "created_at" | "updated_at" | "last_distributed_date" | "distribution_count"
> & {
  id?: string;
};

export type DistributionHistoryRow = {
  id: string;
  building_id: string;
  distributed_date: string;
  distributed_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type DuplicateCandidateRow = {
  id: string;
  new_building_id: string;
  possible_existing_building_id: string;
  address_similarity_score: number;
  name_similarity_score: number;
  distance_meters: number | null;
  reason: string[];
  status: DuplicateResolution;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type ImportBatchRow = {
  id: string;
  file_name: string;
  kind: string;
  total_rows: number;
  inserted_rows: number;
  merged_rows: number;
  duplicate_rows: number;
  skipped_rows: number;
  column_mapping: Record<string, string | null>;
  created_by: string | null;
  created_at: string;
};

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  rental: "賃貸",
  condominium: "分譲",
  unknown: "不明",
};

export const STATUS_LABEL: Record<BuildingStatus, string> = {
  NOT_DISTRIBUTED: "配布対象",
  POSSIBLE_DUPLICATE: "重複候補",
  CONFIRMED_DISTRIBUTED: "配布済み",
};

/**
 * 配布対象とみなす最低世帯数。
 *
 * 総世帯数の自動取得が未実装のため、現状は次の扱いになる。
 *   ・total_units が null（不明） → 表示する（除外しない）
 *   ・total_units が 6 以上       → 表示する
 *   ・total_units が 1〜5         → 非表示
 *
 * 将来 total_units が取得できるようになれば、この値と
 * BuildingFilters.includeUnknownUnits を切り替えるだけで
 * 「6世帯未満を除外」が有効になる。
 */
export const MIN_TOTAL_UNITS_DEFAULT = 6;
