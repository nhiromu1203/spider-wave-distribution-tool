/**
 * 建物データ取得元の共通インターフェースと共通型。
 *
 * ── 設計方針 ────────────────────────────────────────────────
 * 取得元（公的オープンデータ / 外部 API / 別途取得したデータ など）は
 * すべてこの `BuildingDataSource` を実装する。取得元が増えても
 *
 *   ・画面（app/ , components/）
 *   ・重複判定（lib/building-matching/）
 *   ・配布履歴・DB 同期（lib/buildings/）
 *
 * は一切変更しない。取得元ごとの差異はこの層で吸収し、
 * 下流には常に `SourceBuilding` という同じ形だけを流す。
 * ────────────────────────────────────────────────────────────
 */

import type { BuildingSource, PropertyType } from "@/lib/supabase/types";

/**
 * 取得元が返す建物の共通型。
 *
 * 取得できなかった項目は「推測せず null」にすること。
 * 特に total_units は、値が無いことと 0 世帯であることを混同してはならない。
 */
export type SourceBuilding = {
  /** 取得元での識別子。"<source id>:<元 ID>" 形式を推奨（重複取込の判定に使う） */
  source_ref: string | null;

  /** 原本。DB では絶対に上書きしない */
  building_name: string;
  address: string;

  /**
   * エリア。取得元が構造化データを持っていれば渡す。
   * null / 未指定なら住所文字列から解析される（lib/building-matching）。
   */
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;

  /** 取得できなければ "unknown"（画面上は「不明」） */
  property_type: PropertyType;

  /**
   * 建物用途の生の値。OSM の building タグ値（apartments / house など）、
   * または「マンション」「店舗」などの日本語表記をそのまま入れる。
   * 配布対象かどうかの判定は lib/data-sources/building-use が行う。
   */
  building_use_raw?: string | null;

  /** 総世帯数。取得できなければ null（画面上は「不明」）。推測値を入れない */
  total_units: number | null;

  /** 補助判定用。無くても全機能が正常動作する */
  latitude: number | null;
  longitude: number | null;

  /**
   * 住所の出所。"source" なら取得元が最初から持っていた住所、
   * それ以外は補完に使ったデータの識別子（例: "isj"）。
   */
  address_source?: string | null;

  /** 住所の粒度。"housenumber" | "block" | "town" */
  address_precision?: string | null;
};

/** 建物名が取得できなかった場合の表示 */
export const UNKNOWN_BUILDING_NAME = "（建物名不明）";

/** DB へ書き込むときに付与される取得経路（取得元側では設定しない） */
export type SourceOrigin = BuildingSource;

export type AreaQuery = {
  prefecture: string;
  city: string;
  /** 未指定の場合は市区町村全体が対象 */
  town?: string | null;
};

/** 取得元が対応しているエリア */
export type SupportedArea = {
  prefecture: string;
  city: string;
  towns: string[];
};

export type DataSourceAvailability =
  | { available: true }
  | { available: false; reason: string };

export type FetchResult = {
  buildings: SourceBuilding[];
  /** 取得元が返した総件数（ページング等で一部のみ取得した場合の参考値） */
  totalAvailable?: number;
  notes?: string[];
};

export interface BuildingDataSource {
  /** 一意な識別子。BUILDING_DATA_SOURCE の値および source_ref の接頭辞に使う */
  readonly id: string;
  readonly label: string;
  readonly description: string;

  /**
   * 開発確認用のダミーデータかどうか。
   * true の場合、取り込んだ建物は画面上で「開発用データ」と明示される。
   * 本番環境で自動選択されることはない。
   */
  readonly isDevelopment: boolean;

  /** 総世帯数を提供できるか。false なら total_units は常に null になる */
  readonly supportsUnitCount: boolean;

  /** 緯度経度を提供できるか。false なら latitude / longitude は常に null になる */
  readonly supportsCoordinates: boolean;

  /**
   * 利用可能かどうか。接続先未設定・API キー未設定などで使えない場合は
   * 画面にそのまま表示できる日本語の理由を返す。
   */
  isAvailable(): DataSourceAvailability;

  /**
   * この取得元が建物データを取得できるエリアの一覧。
   *
   * エリア選択のプルダウンは行政区域マスタ（lib/data-sources/areas/）から
   * 作られるため、ここに載っていない区も選択肢には出る。
   * ここは「実際に取得できるか」の宣言であり、対応外の区が選ばれたときは
   * その旨を画面に表示するために使う。
   */
  listAreas(): SupportedArea[];

  /**
   * 指定した市区町村の町丁目を列挙する（任意実装）。
   *
   * 取得元が町丁目の索引を持っている場合だけ実装すればよい。
   * 未実装なら、町名の選択肢は取り込み済みデータから作られる。
   */
  listTowns?(area: { prefecture: string; city: string }): Promise<string[]>;

  /**
   * 指定エリアの建物を取得する。
   * area.city は市区町村名で、特定の区に固定してはならない。
   * isAvailable() が false のときは必ず例外を投げ、ネットワークアクセスしないこと。
   */
  fetchByArea(area: AreaQuery): Promise<FetchResult>;

  /** 指定エリアに対応しているか（既定実装は listAreas() との照合） */
  supportsArea?(area: { prefecture: string; city: string }): boolean;
}

/** listAreas() を使った既定の対応判定 */
export function sourceSupportsArea(
  source: BuildingDataSource,
  area: { prefecture: string; city: string },
): boolean {
  if (source.supportsArea) return source.supportsArea(area);
  return source
    .listAreas()
    .some((a) => a.prefecture === area.prefecture && a.city === area.city);
}

/** 開発用データの source_ref に付ける接頭辞 */
export const DEVELOPMENT_SOURCE_PREFIX = "mock";

/**
 * その建物が開発確認用データかどうか。
 * 取得元 id が変わっても既存行を取りこぼさないよう "mock:" と "mock-" の
 * 両方を開発用として扱う。
 */
const DEVELOPMENT_SOURCE_REF = /^mock[-:]/;

export function isDevelopmentData(sourceRef: string | null | undefined): boolean {
  return !!sourceRef && DEVELOPMENT_SOURCE_REF.test(sourceRef);
}

/**
 * 取得元の生データを共通型へ寄せるための補助。
 * 数値として読めない値は必ず null にし、0 と混同しない。
 */
export function toNullableCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** 緯度経度として妥当な範囲の値だけを通す */
export function toNullableCoordinate(
  value: unknown,
  kind: "latitude" | "longitude",
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const limit = kind === "latitude" ? 90 : 180;
  return Math.abs(n) <= limit ? n : null;
}

/** 取得元の種別文字列を PropertyType へ寄せる。判別できなければ "unknown" */
export function toPropertyType(value: unknown): PropertyType {
  if (typeof value !== "string" || value.trim() === "") return "unknown";
  const s = value.normalize("NFKC").toLowerCase();
  if (s.includes("賃貸") || s.includes("rental") || s.includes("rent")) return "rental";
  if (s.includes("分譲") || s.includes("condo") || s.includes("owner")) {
    return "condominium";
  }
  return "unknown";
}
