/**
 * 総世帯数（total_units）の取得インターフェース。
 *
 * ── 現状 ────────────────────────────────────────────────────
 * 総世帯数を提供できる外部データソースが未確定のため、自動取得は
 * 実装していない。値が無い建物の total_units は null のままとし、
 * 画面には「不明」と表示する。推測値を入れてはならない。
 *
 * ── 将来 ────────────────────────────────────────────────────
 * 外部 API / オープンデータ / 建物データ提供サービスなどが決まったら、
 * この interface を実装したモジュールを追加して registry に登録するだけで、
 * 一覧画面・重複判定・フィルタは変更せずに総世帯数が入るようになる。
 *
 * 取得ロジックを UI コンポーネント内に直接書いてはならない。
 * ────────────────────────────────────────────────────────────
 */

/** 総世帯数を引くための建物情報 */
export type UnitCountLookup = {
  building_name: string;
  address: string;
  normalized_address: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type UnitCountResult = {
  /** 取得できた総世帯数。取得できなければ null（＝不明） */
  totalUnits: number | null;
  /** 値の出所（監査用）。例: "public-open-data-2026" */
  source: string | null;
};

export type UnitCountAvailability =
  | { available: true }
  | { available: false; reason: string };

export interface UnitCountProvider {
  readonly id: string;
  readonly label: string;

  isAvailable(): UnitCountAvailability;

  /**
   * 複数件まとめて引く。取得できなかった建物は totalUnits: null を返すこと。
   * 例外を投げず、必ず入力と同じ長さの配列を返す。
   */
  fetchUnitCounts(buildings: UnitCountLookup[]): Promise<UnitCountResult[]>;
}
