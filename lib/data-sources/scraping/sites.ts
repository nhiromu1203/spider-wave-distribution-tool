/**
 * スクレイピング取得先の設定。
 *
 * ── 現在：取得先は未設定 ────────────────────────────────────
 * SCRAPING_SITES は意図的に空にしてある。
 * 接続先が決まるまで ScrapingBuildingDataSource は動かない。
 * ────────────────────────────────────────────────────────────
 *
 * ── 取得先を追加する手順 ────────────────────────────────────
 * 1. そのサイトの利用規約を読み、自動取得が禁止されていないことを確認する
 * 2. https://<サイト>/robots.txt を開き、取得したいパスが
 *    Disallow になっていないことを確認する
 * 3. 可能なら提供元に連絡し、許諾を得る（一番確実）
 * 4. 下の TEMPLATE を複製して SCRAPING_SITES に追加する
 * 5. compliance を正直に埋める。allowsAutomatedAccess を true にできない設定は
 *    起動しない（isAvailable() が false のままになる）
 * 6. .env.local に SCRAPING_SITE_ID=<id> と BUILDING_DATA_SOURCE=scraping を設定
 *
 * 利用規約で自動取得が禁止されているサイト（SUUMO / LIFULL HOME'S など）は
 * types.ts の BLOCKED_HOSTS に列挙してあり、設定に書いても拒否される。
 * ────────────────────────────────────────────────────────────
 */

import { DEFAULT_POLITENESS, type ScrapingSiteConfig } from "./types";

/**
 * 設定の書き方の見本。SCRAPING_SITES には入れていないため使用されない。
 * 新しい取得先はこれを複製して作る。
 */
export const TEMPLATE_SITE_CONFIG: ScrapingSiteConfig = {
  id: "example-open-data",
  label: "（見本）自動取得が許可されたオープンデータサイト",
  description:
    "設定の書き方を示すための見本です。実際には使用されません。",

  baseUrl: "https://opendata.example.jp",
  // {prefecture} {prefectureCode} {city} {cityCode} {town} が置換される。
  // 特定の区を埋め込まないこと（区は引数として渡される）
  listPath: "/buildings/{prefectureCode}/{cityCode}",

  // 町丁目の索引ページがある場合だけ指定する（任意）
  townListPath: "/towns/{prefectureCode}/{cityCode}",
  townItemSelector: "ul.town-list > li a",

  // 建物 1 件を表す要素
  itemSelector: "ul.building-list > li",

  fields: {
    building_name: { selector: ".building-name" },
    address: { selector: ".address" },
    // 一覧に載っていない項目は指定しない → null になる
    property_type: { selector: ".type" },
    // 「全24戸」から 24 だけを取り出す例
    total_units: { selector: ".units", pattern: "(\\d+)" },
    // 属性から取り出す例
    latitude: { selector: "meta[itemprop=latitude]", attribute: "content" },
    longitude: { selector: "meta[itemprop=longitude]", attribute: "content" },
    // source_ref に使う詳細ページの URL
    detail_url: { selector: "a.detail-link", attribute: "href" },
  },

  pagination: { mode: "query", param: "page", startPage: 1, maxPages: 5 },
  politeness: DEFAULT_POLITENESS,

  compliance: {
    termsUrl: "https://opendata.example.jp/terms",
    termsReviewedAt: null,
    robotsCheckedAt: null,
    // 確認が済むまで false。false のあいだは取得元として選べない。
    allowsAutomatedAccess: false,
    basis: null,
  },

  // 特定の区に固定しない。都道府県を指定すると
  // 行政区域マスタから全市区町村（東京都なら23区）へ展開される。
  coverage: { mode: "prefectures", prefectures: ["東京都"] },

  // 正直に名乗る。ブラウザや他のクローラを装わない。
  userAgent:
    "SpiderWaveDistributionTool/1.0 (社内配布対象リスト管理ツール; +連絡先メールアドレスをここに)",
};

/**
 * 実際に使用する取得先。
 * 現時点では空＝取得先未設定。
 */
export const SCRAPING_SITES: ScrapingSiteConfig[] = [];

export function getScrapingSite(id: string): ScrapingSiteConfig | null {
  return SCRAPING_SITES.find((s) => s.id === id) ?? null;
}

/** SCRAPING_SITE_ID で選ばれた設定。未設定なら 1 件目、それも無ければ null */
export function getSelectedScrapingSite(): ScrapingSiteConfig | null {
  const id = process.env.SCRAPING_SITE_ID?.trim();
  if (id) return getScrapingSite(id);
  return SCRAPING_SITES[0] ?? null;
}
