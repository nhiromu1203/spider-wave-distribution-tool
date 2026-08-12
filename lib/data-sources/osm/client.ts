/**
 * Overpass API クライアント。
 *
 * ── 公開APIへの配慮 ────────────────────────────────────────
 * Overpass API は無償で公開されている共有資源であり、
 * 過度な負荷をかけないことが利用の前提になっている。
 *
 * ・取得は区単位。23区を一度に取りにいかない
 * ・同じ区は一定時間キャッシュから返し、再取得しない
 * ・リクエスト間に最小間隔を空け、同時実行しない
 * ・429（枠が空いていない）と 504（タイムアウト）は少数回だけ待って再試行
 * ・それ以外のエラーは再試行せず理由を返す
 * ・User-Agent で自分が何者かを名乗る
 *
 * 制限を回避する処理（プロキシ経由での再試行など）は実装しない。
 * ────────────────────────────────────────────────────────────
 */

import type { OsmElement } from "./convert";

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_QUERY_TIMEOUT_SECONDS = 180;
/** クライアント側は Overpass 側の timeout より少し長く待つ */
const CLIENT_TIMEOUT_MARGIN_MS = 30_000;
/** 同じ区を再取得しない期間 */
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6時間
/** リクエスト間の最小間隔 */
const DEFAULT_MIN_INTERVAL_MS = 5_000;
/**
 * 429 / 504 は混雑による一時的なものが多く、少し待てば通る。
 * 少数回だけ間隔を空けて試し、それでも駄目なら諦める。
 */
const MAX_RETRIES = 2;
const RETRY_WAIT_MS = [15_000, 30_000];

export class OverpassError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "OverpassError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function overpassEndpoint(): string {
  return process.env.OVERPASS_API_URL?.trim() || DEFAULT_ENDPOINT;
}

/**
 * 名乗る User-Agent。
 * HTTP ヘッダーは Latin-1 しか運べないため ASCII のみで構成する
 * （日本語を入れると送信時に例外になる）。
 */
export function overpassUserAgent(): string {
  const configured = process.env.OVERPASS_USER_AGENT?.trim();
  const value =
    configured || "SpiderWaveDistributionTool/1.0 (internal flyer distribution tool)";

  // 設定値に非 ASCII が混ざっていても送信できるようにする
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : "SpiderWaveDistributionTool/1.0 (internal flyer distribution tool)";
}

export function queryTimeoutSeconds(): number {
  const raw = Number(process.env.OVERPASS_TIMEOUT_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUERY_TIMEOUT_SECONDS;
}

function cacheTtlMs(): number {
  const raw = Number(process.env.OVERPASS_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

function minIntervalMs(): number {
  const raw = Number(process.env.OVERPASS_MIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_INTERVAL_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 区ごとの取得結果キャッシュ */
type CacheEntry = { fetchedAt: number; elements: OsmElement[] };
const cache = new Map<string, CacheEntry>();

/** 直近のリクエスト時刻（同時実行を避けるための直列化にも使う） */
let lastRequestAt = 0;
let inFlight: Promise<unknown> = Promise.resolve();

export type OverpassFetch = {
  elements: OsmElement[];
  /** キャッシュから返したか */
  fromCache: boolean;
  cachedAt: Date | null;
};

export function cacheKey(prefecture: string, city: string): string {
  return `${prefecture}/${city}`;
}

/** キャッシュを明示的に捨てる（取得元の切り替え時などに使う） */
export function clearOverpassCache(): void {
  cache.clear();
}

/**
 * Overpass へクエリを投げて要素を取得する。
 * 同じ区の結果がキャッシュにあれば、リクエストせずそれを返す。
 */
export async function fetchOverpass(
  query: string,
  key: string,
  options: { forceRefresh?: boolean } = {},
): Promise<OverpassFetch> {
  const ttl = cacheTtlMs();
  const cached = cache.get(key);

  if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < ttl) {
    return {
      elements: cached.elements,
      fromCache: true,
      cachedAt: new Date(cached.fetchedAt),
    };
  }

  // 同時に複数のリクエストを出さないよう直列化する
  const run = inFlight.then(() => request(query));
  inFlight = run.catch(() => undefined);

  const elements = await run;
  cache.set(key, { fetchedAt: Date.now(), elements });

  return { elements, fromCache: false, cachedAt: null };
}

async function request(query: string): Promise<OsmElement[]> {
  const timeoutSeconds = queryTimeoutSeconds();
  let lastError: OverpassError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // リクエスト間隔を空ける
    const elapsed = Date.now() - lastRequestAt;
    const wait = minIntervalMs() - elapsed;
    if (lastRequestAt > 0 && wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutSeconds * 1000 + CLIENT_TIMEOUT_MARGIN_MS,
    );

    let response: Response;
    try {
      response = await fetch(overpassEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "User-Agent": overpassUserAgent(),
          Accept: "application/json",
        },
        body: query,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new OverpassError(
        aborted
          ? `Overpass API がタイムアウトしました（${timeoutSeconds}秒）。時間をおいて再実行してください。`
          : `Overpass API へ接続できませんでした: ${
              error instanceof Error ? error.message : String(error)
            }`,
        null,
        aborted,
      );
      if (attempt < MAX_RETRIES && lastError.retryable) {
        await sleep(RETRY_WAIT_MS[attempt] ?? 30_000);
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    // 429 = 実行枠が空いていない / 504 = サーバー側タイムアウト。
    // どちらも待てば解消しうるため、少数回だけ間を空けて再試行する。
    if (response.status === 429 || response.status === 504) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : (RETRY_WAIT_MS[attempt] ?? 30_000);

      lastError = new OverpassError(
        response.status === 429
          ? "Overpass API の実行枠が空いていません（429）。時間をおいて再実行してください。"
          : "Overpass API がタイムアウトしました（504）。時間をおいて再実行してください。",
        response.status,
        true,
      );

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new OverpassError(
        `Overpass API がエラーを返しました (HTTP ${response.status} ${response.statusText})${
          body ? `: ${body}` : ""
        }`,
        response.status,
        false,
      );
    }

    let payload: { elements?: OsmElement[] };
    try {
      payload = (await response.json()) as { elements?: OsmElement[] };
    } catch {
      throw new OverpassError(
        "Overpass API のレスポンスを JSON として解釈できませんでした。",
        response.status,
        false,
      );
    }

    return payload.elements ?? [];
  }

  throw (
    lastError ??
    new OverpassError("Overpass API の取得に失敗しました。", null, false)
  );
}
