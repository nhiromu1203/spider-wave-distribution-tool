/**
 * Overpass QL の組み立て。
 *
 * ── 負荷を抑えるための方針 ──────────────────────────────────
 * ・取得は区単位。23区をまとめて取りにいかない
 * ・必要な building タグ（apartments / housing）だけを対象にする
 * ・out center tags で、ジオメトリ全体ではなく中心座標とタグだけ受け取る
 * ・町丁目の絞り込みは取得後にアプリ側で行う（追加リクエストを発生させない）
 * ────────────────────────────────────────────────────────────
 */

/**
 * 配布対象の候補として取得する building タグ。
 *
 * apartments … 集合住宅・マンション・アパート
 * housing    … 集合住宅として使われることがある値。
 *              集合住宅と判断できる場合のみ採用する（convert.ts で選別）
 *
 * residential / yes などは「集合住宅と確実に判断できない」ため取得しない。
 * 取得しないことで Overpass への負荷も下がる。
 */
export const TARGET_BUILDING_TAGS = ["apartments", "housing"] as const;

import { toOverpassBbox, type BBox } from "./tiles";

export type OverpassAreaQuery = {
  prefecture: string;
  city: string;
};

/** Overpass QL の文字列リテラルとして安全な形に整える */
function quote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 指定した区の集合住宅を取得するクエリ。
 *
 * 区名だけでは「北区」「中央区」のように全国で重複するため、
 * 必ず都道府県の境界内に限定して特定する。
 *
 * admin_level: 4 = 都道府県 / 7 = 市区町村（東京23区の特別区）
 */
export function buildBuildingsQuery(
  area: OverpassAreaQuery,
  timeoutSeconds: number,
  /**
   * 取得範囲をこの矩形に限定する（分割取得で使う）。
   * 区の境界（area.ward）との重なりで絞り込むため、
   * 矩形が隣の区にはみ出していても他区の建物は入らない。
   */
  bbox?: BBox | null,
): string {
  const within = bbox ? `(${toOverpassBbox(bbox)})` : "";
  const tags = TARGET_BUILDING_TAGS.map(
    (tag) => `  way["building"="${tag}"](area.ward)${within};
  relation["building"="${tag}"](area.ward)${within};`,
  ).join("\n");

  return `[out:json][timeout:${timeoutSeconds}];
rel["boundary"="administrative"]["admin_level"="4"]["name"="${quote(area.prefecture)}"];
map_to_area->.pref;
rel(area.pref)["boundary"="administrative"]["admin_level"="7"]["name"="${quote(area.city)}"];
map_to_area->.ward;
(
${tags}
);
out center tags;`;
}

/** 件数だけを数えるクエリ（動作確認・件数把握用） */
export function buildCountQuery(
  area: OverpassAreaQuery,
  timeoutSeconds: number,
): string {
  const tags = TARGET_BUILDING_TAGS.map(
    (tag) => `  way["building"="${tag}"](area.ward);
  relation["building"="${tag}"](area.ward);`,
  ).join("\n");

  return `[out:json][timeout:${timeoutSeconds}];
rel["boundary"="administrative"]["admin_level"="4"]["name"="${quote(area.prefecture)}"];
map_to_area->.pref;
rel(area.pref)["boundary"="administrative"]["admin_level"="7"]["name"="${quote(area.city)}"];
map_to_area->.ward;
(
${tags}
);
out count;`;
}
