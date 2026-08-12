/**
 * 総世帯数取得の registry。
 *
 * 新しい取得元を実装したら UNIT_COUNT_PROVIDERS の先頭に追加するだけで、
 * 一覧画面・重複判定・フィルタを変更せずに総世帯数が入るようになる。
 */

import { unavailableUnitCountProvider } from "./unavailable-provider";
import type { UnitCountLookup, UnitCountProvider, UnitCountResult } from "./types";

/** 先頭から順に、最初に利用可能なものが採用される */
export const UNIT_COUNT_PROVIDERS: UnitCountProvider[] = [
  // 例: publicOpenDataUnitCountProvider,
  // 例: externalApiUnitCountProvider,
  unavailableUnitCountProvider,
];

export function getActiveUnitCountProvider(): UnitCountProvider {
  return (
    UNIT_COUNT_PROVIDERS.find((p) => p.isAvailable().available) ??
    unavailableUnitCountProvider
  );
}

/** 総世帯数が自動取得できる状態かどうか */
export function isUnitCountAvailable(): boolean {
  return getActiveUnitCountProvider().isAvailable().available;
}

/**
 * 総世帯数をまとめて解決する。
 * 取得元が未設定の間は、すべて null（＝不明）が返る。
 */
export async function resolveUnitCounts(
  buildings: UnitCountLookup[],
): Promise<UnitCountResult[]> {
  if (buildings.length === 0) return [];
  const provider = getActiveUnitCountProvider();
  try {
    return await provider.fetchUnitCounts(buildings);
  } catch {
    // 取得に失敗しても一覧表示は止めない。値は「不明」のままにする。
    return buildings.map(() => ({ totalUnits: null, source: null }));
  }
}

export { unavailableUnitCountProvider };
export type {
  UnitCountAvailability,
  UnitCountLookup,
  UnitCountProvider,
  UnitCountResult,
} from "./types";
