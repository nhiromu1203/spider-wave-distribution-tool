/**
 * OpenStreetMap の building タグ値と、配布対象判定の対応表。
 *
 * https://wiki.openstreetmap.org/wiki/Key:building の値を基本語彙とする。
 * 取得元が OSM 以外でも、この語彙へ寄せてから判定する。
 *
 * ── 分類の考え方 ────────────────────────────────────────────
 * 配布対象は集合住宅（マンション・アパート）のみ。
 *   building=apartments … 集合住宅・マンション・アパート
 *   building=housing    … 集合住宅として使われる値
 *
 * それ以外はすべて対象外。寮・社宅（dormitory）、長屋・テラスハウス
 * （terrace）も対象外とする。
 * 用途を特定できない値（residential / yes など）も対象外とする。
 * ────────────────────────────────────────────────────────────
 */

/** 集合住宅（配布対象）。これ以外はすべて対象外 */
export const OSM_RESIDENTIAL_MULTI: readonly string[] = [
  "apartments", // 集合住宅・マンション・アパート
  "housing", // 集合住宅として使われる値
];

/** 寮・社宅など、集合住宅以外の居住施設（対象外） */
export const OSM_OTHER_RESIDENTIAL: readonly string[] = [
  "dormitory", // 寮・学生寮・社宅
  "barracks",
  "nursing_home",
  "retirement_home",
];

/** 戸建て・長屋（対象外） */
export const OSM_SINGLE_DWELLING: readonly string[] = [
  "house",
  "detached",
  "semidetached_house",
  "terrace", // 長屋・テラスハウス
  "bungalow",
  "cabin",
  "hut",
  "static_caravan",
  "houseboat",
  "stilt_house",
  "ger",
  "tent",
  "farm", // 農家住宅
];

/** 店舗・商業施設（対象外） */
export const OSM_COMMERCIAL: readonly string[] = [
  "commercial",
  "retail",
  "shop",
  "supermarket",
  "kiosk",
  "marketplace",
  "hotel",
  "motel",
  "restaurant",
];

/** オフィス・事業所（対象外） */
export const OSM_OFFICE: readonly string[] = ["office", "government", "civic"];

/** 工場・倉庫（対象外） */
export const OSM_INDUSTRIAL: readonly string[] = [
  "industrial",
  "warehouse",
  "factory",
  "manufacture",
  "hangar",
  "silo",
  "storage_tank",
  "digester",
  "barn",
  "cowshed",
  "farm_auxiliary",
  "greenhouse",
  "stable",
  "sty",
  "slurry_tank",
];

/** 学校・病院などの施設（対象外） */
export const OSM_INSTITUTIONAL: readonly string[] = [
  "school",
  "university",
  "college",
  "kindergarten",
  "hospital",
  "clinic",
  "public",
  "fire_station",
  "police",
  "prison",
  "museum",
  "library",
  "church",
  "chapel",
  "cathedral",
  "mosque",
  "temple",
  "shrine",
  "synagogue",
  "monastery",
  "religious",
  "presbytery",
  "sports_hall",
  "sports_centre",
  "stadium",
  "grandstand",
  "pavilion",
  "riding_hall",
  "train_station",
  "transportation",
  "military",
  "bunker",
];

/** ガレージ・駐車場など住居以外の建物（対象外） */
export const OSM_ANCILLARY: readonly string[] = [
  "garage",
  "garages",
  "carport",
  "parking",
  "shed",
  "roof",
  "service",
  "transformer_tower",
  "water_tower",
  "container",
  "toilets",
  "kitchen",
  "conservatory",
  "construction",
  "ruins",
  "tower",
  "boathouse",
];

/**
 * 用途を特定できない値（対象外）。
 *
 * building=residential は「住居用建物」を指すだけで、戸建てか集合住宅かを
 * 区別しない。building=yes は用途未指定。いずれも集合住宅と断定できないため
 * 配布対象にしない。
 */
export const OSM_AMBIGUOUS: readonly string[] = [
  "residential",
  "yes",
  "building",
  "unclassified",
];

export type OsmUseCategory =
  | "residential_multi"
  | "other_residential"
  | "single_dwelling"
  | "commercial"
  | "office"
  | "industrial"
  | "institutional"
  | "ancillary"
  | "ambiguous";

const CATEGORY_ENTRIES: Array<[OsmUseCategory, readonly string[]]> = [
  ["residential_multi", OSM_RESIDENTIAL_MULTI],
  ["other_residential", OSM_OTHER_RESIDENTIAL],
  ["single_dwelling", OSM_SINGLE_DWELLING],
  ["commercial", OSM_COMMERCIAL],
  ["office", OSM_OFFICE],
  ["industrial", OSM_INDUSTRIAL],
  ["institutional", OSM_INSTITUTIONAL],
  ["ancillary", OSM_ANCILLARY],
  ["ambiguous", OSM_AMBIGUOUS],
];

const TAG_TO_CATEGORY: Map<string, OsmUseCategory> = new Map(
  CATEGORY_ENTRIES.flatMap(([category, tags]) =>
    tags.map((tag) => [tag, category] as [string, OsmUseCategory]),
  ),
);

/** OSM の building タグ値を分類する。未知の値は null */
export function classifyOsmBuildingTag(tag: string): OsmUseCategory | null {
  return TAG_TO_CATEGORY.get(tag.trim().toLowerCase()) ?? null;
}

/** 日本語表記の各カテゴリ名（画面表示・理由文言用） */
export const CATEGORY_LABEL: Record<OsmUseCategory, string> = {
  residential_multi: "集合住宅",
  other_residential: "寮・社宅",
  single_dwelling: "戸建て・長屋",
  commercial: "店舗・商業施設",
  office: "オフィス・事務所",
  industrial: "工場・倉庫",
  institutional: "学校・病院等の施設",
  ancillary: "ガレージ・駐車場等",
  ambiguous: "用途を特定できない建物",
};
