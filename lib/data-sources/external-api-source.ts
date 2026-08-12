/**
 * ── ExternalApiBuildingDataSource（雛形）──────────────────
 *
 * 外部から建物データを取得する取得元の枠。
 * BASE URL / API キー / タイムアウト / HTTP エラー処理 / レスポンス変換
 * の構造だけを用意してあり、**接続先が設定されるまでネットワークには
 * 一切アクセスしない**（isAvailable() が false のうちは fetch を呼ばない）。
 *
 * ── 重要 ────────────────────────────────────────────────────
 * SUUMO / HOME'S / Yahoo!不動産 などを無断でスクレイピングする実装は
 * ここに書かない。各サイトの利用規約で禁止されており、法的リスクがある。
 *
 * 実際に接続する場合は、以下のいずれかを前提に実装する。
 *   - 提供元と正式に契約した API
 *   - 国土交通省 不動産情報ライブラリ等の公的オープンデータ
 *   - 自社で保有・購入した建物データベース
 * ────────────────────────────────────────────────────────────
 *
 * ── 接続手順 ────────────────────────────────────────────────
 * 1. .env.local に接続先を設定する
 *      BUILDING_DATA_SOURCE=external_api
 *      BUILDING_API_BASE_URL=https://...
 *      BUILDING_API_KEY=...            （不要な提供元なら省略可）
 *      BUILDING_API_TIMEOUT_MS=10000   （任意・既定 10 秒）
 *      BUILDING_API_REQUIRES_KEY=false （API キー不要な提供元の場合）
 * 2. buildRequest() を提供元の仕様に合わせる（パス・クエリ名・認証方式）
 * 3. toSourceBuilding() を実際のレスポンス形に合わせる
 * 4. listAreas() を提供元の対応エリアに合わせる（API から取得してもよい）
 *
 * 画面・重複判定・DB 同期の変更は不要。
 * ────────────────────────────────────────────────────────────
 */

import {
  toNullableCoordinate,
  toNullableCount,
  toPropertyType,
  type AreaQuery,
  type BuildingDataSource,
  type DataSourceAvailability,
  type FetchResult,
  type SourceBuilding,
  type SupportedArea,
} from "./types";

export const EXTERNAL_API_SOURCE_ID = "external_api";

const DEFAULT_TIMEOUT_MS = 10_000;

type ExternalApiConfig = {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
};

/** 提供元が返す 1 件のレスポンス（接続先が決まったら実態に合わせる） */
type ExternalBuildingPayload = {
  id?: string | number | null;
  name?: string | null;
  address?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  units?: number | string | null;
  type?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

type ExternalListResponse = {
  items?: ExternalBuildingPayload[];
  total?: number;
};

function readTimeout(): number {
  const raw = Number(process.env.BUILDING_API_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** API キーが必須かどうか（公的オープンデータなど不要な提供元もある） */
function requiresApiKey(): boolean {
  return process.env.BUILDING_API_REQUIRES_KEY !== "false";
}

/**
 * 設定を読む。未設定なら null を返し、呼び出し側は決してリクエストしない。
 */
function readConfig(): ExternalApiConfig | null {
  const baseUrl = process.env.BUILDING_API_BASE_URL?.trim();
  const apiKey = process.env.BUILDING_API_KEY?.trim() || null;

  if (!baseUrl) return null;
  if (requiresApiKey() && !apiKey) return null;

  return { baseUrl, apiKey, timeoutMs: readTimeout() };
}

/**
 * 対応エリア。接続先が決まったら、その API が返す対応エリアに置き換える。
 * 空のままでもエリア選択は DB 側の値と併せて表示されるため破綻しない。
 */
const AREAS: SupportedArea[] = [];

/** 提供元のレスポンス 1 件を共通型へ変換する。住所が無い行は捨てる。 */
function toSourceBuilding(
  raw: ExternalBuildingPayload,
  sourceId: string,
): SourceBuilding | null {
  const address = (raw.address ?? "").trim();
  if (!address) return null;

  return {
    source_ref: raw.id != null ? `${sourceId}:${raw.id}` : null,
    building_name: (raw.name ?? "").trim() || "（建物名なし）",
    address,
    prefecture: raw.prefecture?.trim() || null,
    city: raw.city?.trim() || null,
    town: raw.town?.trim() || null,
    property_type: toPropertyType(raw.type),
    // 取得できない場合は推測せず null（画面上は「不明」）
    total_units: toNullableCount(raw.units),
    latitude: toNullableCoordinate(raw.lat, "latitude"),
    longitude: toNullableCoordinate(raw.lng, "longitude"),
  };
}

/** 提供元の仕様に合わせてリクエストを組み立てる */
function buildRequest(
  config: ExternalApiConfig,
  area: AreaQuery,
): { url: URL; headers: Record<string, string> } {
  const url = new URL("/buildings", config.baseUrl);
  url.searchParams.set("prefecture", area.prefecture);
  url.searchParams.set("city", area.city);
  if (area.town) url.searchParams.set("town", area.town);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  return { url, headers };
}

export const externalApiBuildingDataSource: BuildingDataSource = {
  id: EXTERNAL_API_SOURCE_ID,
  label: "外部建物データ API",
  description:
    "契約済み API または公的オープンデータからエリア単位で建物を取得します。接続先が設定されるまでネットワークアクセスは行いません。",
  isDevelopment: false,
  // 提供元が返せるかどうかは接続先次第。実装時に実態へ合わせる。
  supportsUnitCount: true,
  supportsCoordinates: true,

  isAvailable(): DataSourceAvailability {
    const baseUrl = process.env.BUILDING_API_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        available: false,
        reason:
          "外部建物データ取得元が未設定です。BUILDING_API_BASE_URL に、契約済み API または公的オープンデータの接続先を設定してください。",
      };
    }
    if (requiresApiKey() && !process.env.BUILDING_API_KEY?.trim()) {
      return {
        available: false,
        reason:
          "外部建物データ取得元の API キーが未設定です。BUILDING_API_KEY を設定してください（キー不要な提供元の場合は BUILDING_API_REQUIRES_KEY=false を設定）。",
      };
    }
    return { available: true };
  },

  listAreas(): SupportedArea[] {
    return AREAS;
  },

  async fetchByArea(area: AreaQuery): Promise<FetchResult> {
    // 未設定のうちは絶対にネットワークへ出ない
    const availability = externalApiBuildingDataSource.isAvailable();
    if (!availability.available) throw new Error(availability.reason);

    const config = readConfig();
    if (!config) {
      throw new Error("外部建物データ取得元の設定を読み込めませんでした。");
    }

    const { url, headers } = buildRequest(config, area);

    // タイムアウト。応答が無いまま画面が固まるのを防ぐ。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `建物データの取得がタイムアウトしました（${config.timeoutMs}ms）。`,
        );
      }
      throw new Error(
        `建物データ取得元へ接続できませんでした: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 本文が空でも原因が分かるよう、必ずステータスを添える
      const body = await response.text().catch(() => "");
      const detail = body.slice(0, 300);
      throw new Error(
        `建物データの取得に失敗しました (HTTP ${response.status} ${response.statusText})${
          detail ? `: ${detail}` : ""
        }`,
      );
    }

    let payload: ExternalListResponse;
    try {
      payload = (await response.json()) as ExternalListResponse;
    } catch {
      throw new Error("建物データ取得元のレスポンスを JSON として解釈できませんでした。");
    }

    const buildings = (payload.items ?? [])
      .map((raw) => toSourceBuilding(raw, externalApiBuildingDataSource.id))
      .filter((b): b is SourceBuilding => b !== null);

    return { buildings, totalAvailable: payload.total ?? buildings.length };
  },
};
