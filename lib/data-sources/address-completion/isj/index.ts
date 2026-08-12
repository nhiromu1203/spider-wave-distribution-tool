import "server-only";

/**
 * 街区レベル位置参照情報による住所補完。
 *
 * 座標を最寄りの街区基準点に対応づけて「町丁目＋街区符号」を得る。
 * 住居番号は含まれないため precision は "block"。
 *
 * ── 速度 ────────────────────────────────────────────────────
 * 全点との距離を総当たりで測ると 460 件 × 2,850 点 で遅くなるため、
 * 0.01 度（約 1km）のグリッドに索引を張り、周囲 9 マスだけを調べる。
 * 索引は市区町村ごとにプロセス内へ保持し、再構築しない。
 * ────────────────────────────────────────────────────────────
 */

import { getPrefectureCode } from "../../areas";
import type {
  AddressCompletionProvider,
  CompletedAddress,
  CompletionAvailability,
  LatLon,
} from "../types";
import {
  ATTRIBUTION,
  isDatasetCached,
  loadPrefectureDataset,
  type BlockPoint,
} from "./dataset";

export const ISJ_PROVIDER_ID = "isj";

/** これより遠い街区にしか当たらない場合は補完しない */
const MAX_SNAP_DISTANCE_M = 200;

/** グリッドの一辺（度）。緯度 0.01 度 ≒ 1.1km */
const GRID_SIZE = 0.01;

const EARTH_RADIUS_M = 6371008.8;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

function distanceMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type GridIndex = Map<string, BlockPoint[]>;

const gridCache = new Map<string, GridIndex>();

function gridKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_SIZE)}:${Math.floor(lon / GRID_SIZE)}`;
}

function buildGrid(points: BlockPoint[]): GridIndex {
  const grid: GridIndex = new Map();
  for (const point of points) {
    const key = gridKey(point.latitude, point.longitude);
    const bucket = grid.get(key);
    if (bucket) bucket.push(point);
    else grid.set(key, [point]);
  }
  return grid;
}

function findNearest(
  grid: GridIndex,
  lat: number,
  lon: number,
): { point: BlockPoint; distance: number } | null {
  const baseLat = Math.floor(lat / GRID_SIZE);
  const baseLon = Math.floor(lon / GRID_SIZE);

  let best: BlockPoint | null = null;
  let bestDistance = Infinity;

  // 周囲 9 マスを調べる（グリッド 1 辺が約 1km なので 200m 探索には十分）
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const bucket = grid.get(`${baseLat + dLat}:${baseLon + dLon}`);
      if (!bucket) continue;
      for (const point of bucket) {
        const distance = distanceMeters(lat, lon, point.latitude, point.longitude);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = point;
        }
      }
    }
  }

  return best ? { point: best, distance: bestDistance } : null;
}

/**
 * 「東日暮里一丁目」＋街区符号「5」→「東京都荒川区東日暮里一丁目5」
 * 既存の住所正規化がそのまま解釈できる形にする。
 */
function composeAddress(
  prefecture: string,
  city: string,
  point: BlockPoint,
): string {
  return `${prefecture}${city}${point.town}${point.block}`;
}

export const isjAddressCompletionProvider: AddressCompletionProvider = {
  id: ISJ_PROVIDER_ID,
  label: "街区レベル位置参照情報（国土交通省）",
  precision: "block",

  isAvailable(): CompletionAvailability {
    if (process.env.ADDRESS_COMPLETION_DISABLED === "1") {
      return {
        available: false,
        reason:
          "住所補完は ADDRESS_COMPLETION_DISABLED=1 により無効化されています。",
      };
    }
    return { available: true };
  },

  /** 都道府県コードが分かるエリアなら全国どこでも対応できる */
  supportsPrefecture(prefecture: string): boolean {
    return getPrefectureCode(prefecture) !== null;
  },

  async complete(
    points: LatLon[],
    context: { prefecture: string; city?: string | null },
  ): Promise<Array<CompletedAddress | null>> {
    if (points.length === 0) return [];

    const prefectureCode = getPrefectureCode(context.prefecture);
    if (!prefectureCode) return points.map(() => null);

    const dataset = await loadPrefectureDataset(prefectureCode);

    // 市区町村が分かっていればその範囲だけを索引する（高速かつ誤対応を防ぐ）
    const cityName = context.city ?? null;
    const cacheKey = `${prefectureCode}/${cityName ?? "*"}`;

    let grid = gridCache.get(cacheKey);
    if (!grid) {
      const source = cityName
        ? (dataset.byCity[cityName] ?? [])
        : Object.values(dataset.byCity).flat();
      grid = buildGrid(source);
      gridCache.set(cacheKey, grid);
    }

    return points.map((point) => {
      if (
        !Number.isFinite(point.latitude) ||
        !Number.isFinite(point.longitude)
      ) {
        return null;
      }

      const nearest = findNearest(grid!, point.latitude, point.longitude);
      if (!nearest || nearest.distance > MAX_SNAP_DISTANCE_M) return null;

      const city = cityName ?? "";
      return {
        address: composeAddress(dataset.prefectureName, city, nearest.point),
        prefecture: dataset.prefectureName,
        city: city || null,
        town: nearest.point.town,
        precision: "block",
        source: ISJ_PROVIDER_ID,
        distanceMeters: Math.round(nearest.distance),
      };
    });
  },
};

export { ATTRIBUTION, isDatasetCached, loadPrefectureDataset } from "./dataset";
export { clearDatasetMemoryCache, getDatasetDirectory } from "./dataset";

/** 索引のキャッシュを捨てる（データセット更新時に使う） */
export function clearGridCache(): void {
  gridCache.clear();
}
