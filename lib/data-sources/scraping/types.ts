/**
 * スクレイピング取得元の設定型。
 *
 * 対象 URL・CSS セレクタ・ページネーション方式をすべて設定値として外出しし、
 * 取得元を差し替えてもコードを書き換えずに済むようにする。
 *
 * ── 前提 ────────────────────────────────────────────────────
 * 接続してよいのは「自動取得が許可されているサイト」だけ。
 * robots.txt と利用規約を人が確認し、その事実を compliance に記録しない限り
 * この取得元は動かない（isAvailable() が false のままになる）。
 * ────────────────────────────────────────────────────────────
 */

import { listCities } from "../areas";
import type { SupportedArea } from "../types";

/**
 * 取得元が対応するエリアの宣言。
 * 特定の区に固定しないための型。
 */
export type AreaCoverage =
  /** 指定した都道府県の全市区町村（行政区域マスタから展開） */
  | { mode: "prefectures"; prefectures: string[] }
  /** 明示した市区町村のみ */
  | { mode: "cities"; cities: Array<{ prefecture: string; city: string }> };

/** 対応範囲の宣言を SupportedArea[] に展開する */
export function expandCoverage(coverage: AreaCoverage): SupportedArea[] {
  if (coverage.mode === "cities") {
    return coverage.cities.map((c) => ({
      prefecture: c.prefecture,
      city: c.city,
      // 町丁目は数が多く変動もあるためマスタに持たない。
      // 取得元が listTowns() を実装していればそこから、
      // なければ取り込み済みデータから選択肢が作られる。
      towns: [],
    }));
  }

  return coverage.prefectures.flatMap((prefecture) =>
    listCities(prefecture).map((city) => ({ prefecture, city, towns: [] })),
  );
}

/** SourceBuilding のうち、HTML から抽出しうる項目 */
export type ScrapableField =
  | "building_name"
  | "address"
  | "prefecture"
  | "city"
  | "town"
  | "property_type"
  | "building_use"
  | "total_units"
  | "latitude"
  | "longitude"
  | "detail_url";

/**
 * 1 項目の取り出し方。
 * 既定ではテキストを読む。属性から取りたい場合は attribute を指定する。
 */
export type FieldSelector = {
  /** CSS セレクタ。item 要素からの相対で解決される */
  selector: string;
  /** 指定するとテキストではなくこの属性値を読む（例: "href", "content"） */
  attribute?: string;
  /**
   * 値の中から一部だけ取り出したい場合の正規表現。
   * 最初のキャプチャグループが採用される（例: /全(\d+)戸/）。
   */
  pattern?: string;
};

export type PaginationConfig =
  /** 1 ページのみ取得する */
  | { mode: "none" }
  /** クエリパラメータでページ送りする（例: ?page=2） */
  | { mode: "query"; param: string; startPage: number; maxPages: number }
  /** 「次へ」リンクを辿る */
  | { mode: "next-link"; selector: string; maxPages: number };

/**
 * アクセス頻度の制御。
 * 相手のサーバーに負荷をかけないため、既定値は意図的に控えめにしてある。
 */
export type PolitenessConfig = {
  /** 連続リクエストの最小間隔（ms）。robots.txt の Crawl-delay の方が長ければそちらを優先 */
  minIntervalMs: number;
  /** 1 リクエストのタイムアウト（ms） */
  timeoutMs: number;
  /** 一時的な失敗（ネットワーク断・5xx）に限ったリトライ上限 */
  maxRetries: number;
  /** リトライ間隔の基準（ms）。指数バックオフする */
  retryBackoffMs: number;
  /** 1 回の取得で辿る最大ページ数 */
  maxPages: number;
  /** 1 回の取得で受け入れる最大件数 */
  maxItems: number;
};

/**
 * 自動取得が許可されていることの確認記録。
 * ここが埋まっていない設定は使用できない。
 */
export type ComplianceRecord = {
  /** 利用規約の URL */
  termsUrl: string | null;
  /** 利用規約を人が確認した日（YYYY-MM-DD） */
  termsReviewedAt: string | null;
  /** robots.txt を人が確認した日（YYYY-MM-DD） */
  robotsCheckedAt: string | null;
  /**
   * 自動取得が許可されていると人が判断したか。
   * true にする責任は設定を書いた人にある。false のままなら動かない。
   */
  allowsAutomatedAccess: boolean;
  /** 許可の根拠（規約の該当条項、提供元からの許諾メールなど） */
  basis: string | null;
};

export type ScrapingSiteConfig = {
  /** 取得元の識別子。source_ref の接頭辞になる */
  id: string;
  label: string;
  description: string;

  /** 取得先のオリジン（例: "https://opendata.example.jp"） */
  baseUrl: string;

  /**
   * 一覧ページのパス。以下のプレースホルダを置換する。
   *   {prefecture}     都道府県名（例「東京都」）
   *   {prefectureCode} 都道府県コード（例「13」）
   *   {city}           市区町村名（例「荒川区」）
   *   {cityCode}       全国地方公共団体コード（例「13118」）
   *   {town}           町丁目（未指定なら空文字）
   *
   * 例: "/buildings/{prefectureCode}/{cityCode}"
   *
   * 特定の区を埋め込んではならない。区は引数として渡される。
   */
  listPath: string;

  /**
   * 町丁目の索引ページ（任意）。プレースホルダは listPath と同じ。
   * 指定すると listTowns() が使えるようになる。
   */
  townListPath?: string;

  /** 町丁目索引ページで、町名 1 件を表す要素のセレクタ */
  townItemSelector?: string;

  /** 建物 1 件を表す要素のセレクタ */
  itemSelector: string;

  /** 各項目の取り出し方。未指定の項目は null になる */
  fields: Partial<Record<ScrapableField, FieldSelector>>;

  pagination: PaginationConfig;
  politeness: PolitenessConfig;
  compliance: ComplianceRecord;

  /**
   * この取得元が建物データを取得できる範囲。
   * 特定の区に固定せず、都道府県単位・市区町村単位で宣言する。
   *
   *   { mode: "prefectures", prefectures: ["東京都"] }
   *     → その都道府県の全市区町村（行政区域マスタから展開）
   *   { mode: "cities", cities: [{ prefecture, city }, ...] }
   *     → 明示した市区町村のみ
   */
  coverage: AreaCoverage;

  /**
   * 名乗る User-Agent。
   * 連絡先を含む正直な文字列にすること。ブラウザや他のクローラを
   * 装う文字列を入れてはならない（アクセス制限の回避にあたるため）。
   */
  userAgent: string;
};

/** politeness の既定値。控えめな設定を既定にしておく。 */
export const DEFAULT_POLITENESS: PolitenessConfig = {
  minIntervalMs: 3000,
  timeoutMs: 15000,
  maxRetries: 2,
  retryBackoffMs: 2000,
  maxPages: 10,
  maxItems: 1000,
};

/**
 * 利用規約で自動取得が禁止されていることが分かっているホスト。
 * 設定に書かれていてもここに一致したら必ず拒否する。
 *
 * 「開発用だから」「一度だけだから」といった理由でも解除しない。
 */
export const BLOCKED_HOSTS: readonly string[] = [
  "suumo.jp",
  "homes.co.jp",
  "lifull.com",
  "athome.co.jp",
  "realestate.yahoo.co.jp",
  "yahoo.co.jp",
  "chintai.net",
  "apamanshop.com",
  "minimini.jp",
  "able.co.jp",
  "homemate.co.jp",
  "rakumachi.jp",
];

/** ホストがブロック対象か（サブドメインも含めて判定） */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return BLOCKED_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}
