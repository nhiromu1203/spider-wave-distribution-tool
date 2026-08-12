/**
 * ジオコーディングの registry。
 *
 * 新しい取得元を実装したら GEOCODING_PROVIDERS の先頭に追加するだけで、
 * 一覧画面・重複判定・DB スキーマを変更せずに座標が入るようになる。
 */

import type {
  GeocodeLookup,
  GeocodeResult,
  GeocodingAvailability,
  GeocodingProvider,
} from "./types";

/**
 * 取得元が未確定の間に使う実装。常に null を返し、座標を推測しない。
 */
export const unavailableGeocodingProvider: GeocodingProvider = {
  id: "unavailable",
  label: "緯度経度の取得元は未設定",

  isAvailable(): GeocodingAvailability {
    return {
      available: false,
      reason:
        "緯度経度を提供するデータソースが未確定のため、自動取得は行いません。座標が無くても重複判定は住所と建物名で正常に動作します。",
    };
  },

  async geocode(addresses: GeocodeLookup[]): Promise<GeocodeResult[]> {
    return addresses.map(() => ({ latitude: null, longitude: null, source: null }));
  },
};

/** 先頭から順に、最初に利用可能なものが採用される */
export const GEOCODING_PROVIDERS: GeocodingProvider[] = [
  // 例: gsiGeocodingProvider,
  unavailableGeocodingProvider,
];

export function getActiveGeocodingProvider(): GeocodingProvider {
  return (
    GEOCODING_PROVIDERS.find((p) => p.isAvailable().available) ??
    unavailableGeocodingProvider
  );
}

export function isGeocodingAvailable(): boolean {
  return getActiveGeocodingProvider().isAvailable().available;
}

/**
 * 座標をまとめて解決する。
 * 取得元が未設定の間は、すべて null が返る。
 */
export async function resolveCoordinates(
  addresses: GeocodeLookup[],
): Promise<GeocodeResult[]> {
  if (addresses.length === 0) return [];
  const provider = getActiveGeocodingProvider();
  try {
    return await provider.geocode(addresses);
  } catch {
    // 取得に失敗しても一覧表示は止めない。座標は null のままにする。
    return addresses.map(() => ({ latitude: null, longitude: null, source: null }));
  }
}

export type {
  GeocodeLookup,
  GeocodeResult,
  GeocodingAvailability,
  GeocodingProvider,
} from "./types";
