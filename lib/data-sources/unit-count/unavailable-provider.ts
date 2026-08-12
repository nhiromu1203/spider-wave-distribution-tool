/**
 * 総世帯数の取得元が未確定の間に使う実装。
 * 常に null（＝不明）を返し、値を推測しない。
 *
 * 実データを提供する Provider を追加したら index.ts の registry に登録する。
 * 呼び出し側（一覧画面・取込処理）は一切変更不要。
 */

import type {
  UnitCountAvailability,
  UnitCountLookup,
  UnitCountProvider,
  UnitCountResult,
} from "./types";

export const unavailableUnitCountProvider: UnitCountProvider = {
  id: "unavailable",
  label: "総世帯数の取得元は未設定",

  isAvailable(): UnitCountAvailability {
    return {
      available: false,
      reason:
        "総世帯数を提供するデータソースが未確定のため、自動取得は行いません。値は「不明」のままになります。",
    };
  },

  async fetchUnitCounts(buildings: UnitCountLookup[]): Promise<UnitCountResult[]> {
    // 推測はしない。必ず入力と同じ長さで null を返す。
    return buildings.map(() => ({ totalUnits: null, source: null }));
  },
};
