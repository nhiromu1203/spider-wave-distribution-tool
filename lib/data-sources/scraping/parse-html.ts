/**
 * HTML → SourceBuilding への変換。
 *
 * 取得元ごとの差異は「設定（CSS セレクタ）」だけで吸収し、
 * このファイルのロジックは取得元を問わず共通に保つ。
 * 取得できなかった項目は推測せず必ず null にする。
 */

import * as cheerio from "cheerio";
import { parseAddressParts } from "@/lib/building-matching";
import {
  toNullableCoordinate,
  toNullableCount,
  toPropertyType,
  type SourceBuilding,
} from "../types";
import type { FieldSelector, ScrapableField, ScrapingSiteConfig } from "./types";

type Root = cheerio.CheerioAPI;
type Element = Parameters<Root>[0];

/** セレクタ設定に従って 1 項目を文字列として取り出す。取れなければ null */
function extract(
  $: Root,
  scope: cheerio.Cheerio<never>,
  field: FieldSelector | undefined,
): string | null {
  if (!field) return null;

  // セレクタが空なら item 要素そのものを対象にする
  const target = field.selector ? scope.find(field.selector).first() : scope;
  if (target.length === 0) return null;

  const raw = field.attribute
    ? (target.attr(field.attribute) ?? null)
    : target.text();

  if (raw === null) return null;

  // 連続する空白・改行を 1 つにまとめる（HTML の整形由来のノイズを落とす）
  let value = raw.replace(/\s+/g, " ").trim();
  if (!value) return null;

  if (field.pattern) {
    try {
      const matched = value.match(new RegExp(field.pattern));
      if (!matched) return null;
      value = (matched[1] ?? matched[0]).trim();
      if (!value) return null;
    } catch {
      // 設定の正規表現が壊れている場合は、その項目を諦める（取得全体は止めない）
      return null;
    }
  }

  return value;
}

export type ParsedPage = {
  buildings: SourceBuilding[];
  /** pagination.mode === "next-link" のときの次ページ URL */
  nextPageUrl: string | null;
  /** ページ内で item セレクタに一致した要素数（0 ならセレクタ設定を疑う） */
  itemCount: number;
};

/**
 * 一覧ページの HTML を SourceBuilding[] に変換する。
 *
 * 住所が取れない行は捨てる。住所は重複判定の最優先キーであり、
 * 無いまま登録すると配布済み判定ができなくなるため。
 */
export function parseListPage(
  html: string,
  config: ScrapingSiteConfig,
  pageUrl: URL,
): ParsedPage {
  const $ = cheerio.load(html);
  const items = $(config.itemSelector);
  const buildings: SourceBuilding[] = [];

  items.each((_, element) => {
    const scope = $(element) as unknown as cheerio.Cheerio<never>;
    const get = (field: ScrapableField) => extract($, scope, config.fields[field]);

    const address = get("address");
    if (!address) return;

    const buildingName = get("building_name");

    // 都道府県・市区町村・町名は、取得元が返していればそれを使い、
    // 無ければ住所文字列から解析する（推測ではなく構文解析）
    const parts = parseAddressParts(address);

    const detailUrl = get("detail_url");
    const sourceRef = detailUrl
      ? `${config.id}:${new URL(detailUrl, pageUrl).toString()}`
      : null;

    buildings.push({
      source_ref: sourceRef,
      building_name: buildingName || "（建物名なし）",
      address,
      prefecture: get("prefecture") ?? parts.prefecture,
      city: get("city") ?? parts.city,
      town: get("town") ?? parts.town,
      property_type: toPropertyType(get("property_type")),
      building_use_raw: get("building_use") ?? get("property_type"),
      // 取れなければ null。0 世帯と混同しない。
      total_units: toNullableCount(get("total_units")),
      latitude: toNullableCoordinate(get("latitude"), "latitude"),
      longitude: toNullableCoordinate(get("longitude"), "longitude"),
    });
  });

  let nextPageUrl: string | null = null;
  if (config.pagination.mode === "next-link") {
    const href = $(config.pagination.selector).first().attr("href");
    if (href) nextPageUrl = new URL(href, pageUrl).toString();
  }

  return { buildings, nextPageUrl, itemCount: items.length };
}

/**
 * 町丁目の索引ページから町名を取り出す。
 * 「東日暮里（120件）」のような装飾が付いていても町名だけを拾う。
 */
export function parseTownIndex(html: string, itemSelector: string): string[] {
  const $ = cheerio.load(html);
  const towns = new Set<string>();

  $(itemSelector).each((_, element) => {
    const raw = $(element).text().replace(/\s+/g, " ").trim();
    if (!raw) return;
    // 末尾の件数表記（全角・半角の括弧）を落とす
    const name = raw.replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
    if (name) towns.add(name);
  });

  return [...towns].sort((a, b) => a.localeCompare(b, "ja"));
}
