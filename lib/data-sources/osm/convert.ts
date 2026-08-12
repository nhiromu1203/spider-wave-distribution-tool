/**
 * OSM の要素を SourceBuilding へ変換する。
 *
 * ── 判定方針 ────────────────────────────────────────────────
 * 配布対象は住居専用の集合住宅のみ。
 * 戸建て・店舗付き・寮・社宅などが紛れ込むくらいなら、
 * 判断がつかない建物は落とす（取りこぼしを許容する）。
 * ────────────────────────────────────────────────────────────
 */

import { classifyBuildingUse } from "../building-use";
import type { SourceBuilding } from "../types";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  /** way / relation は out center により中心座標が入る */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type ConversionReason =
  | "accepted"
  | "not_multi_dwelling"
  | "mixed_use"
  | "dormitory"
  | "name_excluded"
  | "no_address"
  | "no_coordinates";

export type ConversionResult =
  | { accepted: true; building: SourceBuilding }
  | { accepted: false; reason: ConversionReason; detail: string; name: string | null };

export type ConversionStats = {
  total: number;
  accepted: number;
  rejected: Record<Exclude<ConversionReason, "accepted">, number>;
  withName: number;
  withAddress: number;
  withCoordinates: number;
  withTotalUnits: number;
};

/** 建物名を示すタグ。日本語表記を優先する */
const NAME_TAGS = ["name:ja", "name", "official_name", "name:ja-Hira", "name:en"];

export { UNKNOWN_BUILDING_NAME } from "../types";
import { UNKNOWN_BUILDING_NAME } from "../types";

/**
 * 住居専用でないことを示すタグ。
 * 店舗・事務所・宿泊施設などが同じ建物に入っている場合に付く。
 */
const MIXED_USE_TAGS = [
  "shop",
  "office",
  "amenity",
  "tourism",
  "craft",
  "healthcare",
  "leisure",
  "club",
];

/** 住居ではあるが集合住宅ではない用途 */
const NON_APARTMENT_RESIDENTIAL = [
  "dormitory",
  "university",
  "college",
  "retirement_home",
  "nursing_home",
  "assisted_living",
];

function pickName(tags: Record<string, string>): string | null {
  for (const key of NAME_TAGS) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

/** 取得したエリア。addr:province / addr:city が無い建物を補うために使う */
export type AreaContext = { prefecture: string; city: string };

/**
 * 丁目を表す値を正規化する。
 * OSM では "七丁目" のように丁目付きのこともあれば、"7" だけのこともある。
 * 数字だけの場合は丁目を補い、番地と地続きにならないようにする。
 */
function normalizeChome(value: string): string {
  if (!value) return "";
  return /^[0-9０-９]+$/.test(value) ? `${value}丁目` : value;
}

/**
 * addr:* タグから住所文字列を組み立てる。
 * 既存の住所正規化（lib/building-matching）がそのまま解釈できる形にする。
 *
 * addr:province / addr:city が無い建物が多いため、取得したエリアで補う。
 * これは推測ではなく、その区の境界内を検索した結果であることに基づく。
 */
export function buildAddress(
  tags: Record<string, string>,
  area?: AreaContext,
): string | null {
  const full = tags["addr:full"]?.trim();
  if (full) {
    // addr:full に都道府県・市区町村が無ければ補う
    if (area && !full.includes(area.city)) {
      return `${area.prefecture}${area.city}${full}`;
    }
    return full;
  }

  const province = tags["addr:province"]?.trim() || area?.prefecture || "";
  const city = tags["addr:city"]?.trim() || area?.city || "";
  // 町名・丁目は自治体によって使うタグが分かれるため、順に連結する
  const suburb = tags["addr:suburb"]?.trim() ?? "";
  const quarter = normalizeChome(tags["addr:quarter"]?.trim() ?? "");
  const neighbourhood = normalizeChome(tags["addr:neighbourhood"]?.trim() ?? "");
  const street = tags["addr:street"]?.trim() ?? "";
  const block = tags["addr:block_number"]?.trim() ?? "";
  const houseNumber = tags["addr:housenumber"]?.trim() ?? "";

  // 町名が無ければ配布先を特定できない
  if (!suburb && !quarter && !neighbourhood && !street) return null;

  const locality = `${province}${city}${suburb}${quarter}${neighbourhood}${street}`;

  // 街区符号と住居番号は "5-3" の形にする（正規化側で 1-5-3 に整う）
  const numbers = [block, houseNumber].filter(Boolean).join("-");

  // 町名だけで番地がまったく無い住所は、配布先を特定できないため採用しない
  if (!numbers) return null;

  return `${locality}${numbers}`;
}

/** OSM の総戸数タグ。無ければ null（推定値は入れない） */
function pickTotalUnits(tags: Record<string, string>): number | null {
  for (const key of ["building:flats", "flats", "building:units"]) {
    const raw = tags[key];
    if (!raw) continue;
    const n = Number(raw.replace(/[^\d]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function coordinates(element: OsmElement): { lat: number; lon: number } | null {
  if (element.center) return element.center;
  if (element.lat !== undefined && element.lon !== undefined) {
    return { lat: element.lat, lon: element.lon };
  }
  return null;
}

/**
 * OSM 要素 1 件を変換する。配布対象にならない場合は理由を返す。
 */
export function convertElement(
  element: OsmElement,
  area?: AreaContext,
): ConversionResult {
  const tags = element.tags ?? {};
  const name = pickName(tags);
  const building = tags.building?.trim().toLowerCase() ?? "";

  // ── 住居ではない用途が同居している建物を落とす ──────────────
  const mixed = MIXED_USE_TAGS.find((key) => tags[key]);
  if (mixed) {
    return {
      accepted: false,
      reason: "mixed_use",
      detail: `住居以外の用途タグ ${mixed}=${tags[mixed]} が付いているため対象外`,
      name,
    };
  }
  if (tags["building:use"] && tags["building:use"] !== "residential") {
    return {
      accepted: false,
      reason: "mixed_use",
      detail: `building:use=${tags["building:use"]} のため対象外`,
      name,
    };
  }

  // ── 寮・社宅・高齢者施設を落とす ────────────────────────────
  const residential = tags.residential?.trim().toLowerCase();
  if (residential && NON_APARTMENT_RESIDENTIAL.includes(residential)) {
    return {
      accepted: false,
      reason: "dormitory",
      detail: `residential=${residential} のため対象外`,
      name,
    };
  }

  // ── building タグの確認 ─────────────────────────────────────
  if (building === "housing") {
    // housing は集合住宅と断定できないため、集合住宅を示す根拠がある場合のみ採用
    const looksResidentialMulti =
      pickTotalUnits(tags) !== null ||
      residential === "apartments" ||
      (name !== null &&
        classifyBuildingUse(null, name).use === "RESIDENTIAL_MULTI");

    if (!looksResidentialMulti) {
      return {
        accepted: false,
        reason: "not_multi_dwelling",
        detail: "building=housing だが集合住宅と判断できる根拠がないため対象外",
        name,
      };
    }
  } else if (building !== "apartments") {
    return {
      accepted: false,
      reason: "not_multi_dwelling",
      detail: `building=${building || "（なし）"} は配布対象の集合住宅ではない`,
      name,
    };
  }

  // ── 建物名が対象外を示す場合は落とす（社宅・寮・店舗など）──
  if (name) {
    const byName = classifyBuildingUse(null, name);
    if (byName.use === "EXCLUDED" && !byName.excludedAsUnknown) {
      return {
        accepted: false,
        reason: "name_excluded",
        detail: byName.reason,
        name,
      };
    }
  }

  // ── 住所 ────────────────────────────────────────────────────
  const address = buildAddress(tags, area);
  const coords = coordinates(element);

  // 住所も座標も無ければ配布先を特定できないので落とす。
  // 座標があれば、住所は後段の補完に任せる（address を空で通す）。
  if (!address && !coords) {
    return {
      accepted: false,
      reason: "no_address",
      detail: "住所タグも座標も無いため登録しない",
      name,
    };
  }

  return {
    accepted: true,
    building: {
      source_ref: `osm:${element.type}/${element.id}`,
      // 建物名が無くても、集合住宅であることが明確なら捨てない
      building_name: name ?? UNKNOWN_BUILDING_NAME,
      // 空文字なら「住所未確定」。後段の住所補完で埋める。
      address: address ?? "",
      address_source: address ? "source" : null,
      address_precision: address ? "housenumber" : null,
      prefecture: tags["addr:province"]?.trim() || area?.prefecture || null,
      city: tags["addr:city"]?.trim() || area?.city || null,
      // 町名は住所文字列から解析させる（addr:suburb が丁目を含むことがあるため）
      town: null,
      property_type: "unknown",
      // 判定は既存の building-use モジュールに委ねる
      building_use_raw: building,
      // OSM に総戸数が無ければ null。推定値は入れない。
      total_units: pickTotalUnits(tags),
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
    },
  };
}

/** 要素の配列をまとめて変換し、内訳を返す */
export function convertElements(
  elements: OsmElement[],
  area?: AreaContext,
): {
  buildings: SourceBuilding[];
  stats: ConversionStats;
  rejectedSamples: Array<{ name: string | null; reason: string; detail: string }>;
} {
  const buildings: SourceBuilding[] = [];
  const rejectedSamples: Array<{ name: string | null; reason: string; detail: string }> =
    [];

  const stats: ConversionStats = {
    total: elements.length,
    accepted: 0,
    rejected: {
      not_multi_dwelling: 0,
      mixed_use: 0,
      dormitory: 0,
      name_excluded: 0,
      no_address: 0,
      no_coordinates: 0,
    },
    withName: 0,
    withAddress: 0,
    withCoordinates: 0,
    withTotalUnits: 0,
  };

  for (const element of elements) {
    const result = convertElement(element, area);

    if (!result.accepted) {
      stats.rejected[result.reason as Exclude<ConversionReason, "accepted">]++;
      if (rejectedSamples.length < 20) {
        rejectedSamples.push({
          name: result.name,
          reason: result.reason,
          detail: result.detail,
        });
      }
      continue;
    }

    stats.accepted++;
    if (result.building.building_name !== UNKNOWN_BUILDING_NAME) stats.withName++;
    if (result.building.address) stats.withAddress++;
    if (result.building.latitude !== null) stats.withCoordinates++;
    if (result.building.total_units !== null) stats.withTotalUnits++;

    buildings.push(result.building);
  }

  return { buildings, stats, rejectedSamples };
}
