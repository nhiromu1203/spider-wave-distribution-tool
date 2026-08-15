import "server-only";

/**
 * 号レベルの住所を座標に変換する。
 *
 * 国土地理院のジオコーディング API を使う。無料・キー不要で、
 * 実測では号ごとに別の座標を返すことを確認している
 * （東日暮里4-35-6 / -10 / -13 / -16 の4件がすべて別座標）。
 *
 * 逆ジオコーダ（LonLatToAddress）は町字までしか返さないため使えない。
 * 使うのは順方向の AddressSearch のほう。
 *
 * 出典表示: 国土地理院
 */

export const GSI_ATTRIBUTION = "国土地理院 ジオコーディングAPI";

const ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const USER_AGENT = "SpiderWaveDistributionTool/1.0 (internal flyer distribution tool)";

/** 公開 API への配慮。連続して叩かない */
const MIN_INTERVAL_MS = 500;
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 同じ住所を二度引かない（プロセス内） */
const cache = new Map<string, { latitude: number; longitude: number } | null>();

export function clearGeocodeCache(): void {
  cache.clear();
}

export type GeocodeResult = { latitude: number; longitude: number } | null;

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = address.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt > 0 && wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${ENDPOINT}?q=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      cache.set(key, null);
      return null;
    }

    const payload = (await response.json()) as Array<{
      geometry?: { coordinates?: [number, number] };
    }>;

    const coordinates = payload?.[0]?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) {
      cache.set(key, null);
      return null;
    }

    // GeoJSON は [経度, 緯度] の順
    const result = { latitude: coordinates[1], longitude: coordinates[0] };
    cache.set(key, result);
    return result;
  } catch {
    // 取れなくても処理は続ける。座標が無い候補は判定から外れるだけ。
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
