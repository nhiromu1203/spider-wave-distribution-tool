/**
 * 緯度経度（ジオコーディング）の取得インターフェース。
 *
 * ── 現状 ────────────────────────────────────────────────────
 * 自動取得は未実装。latitude / longitude は null のままとし、
 * 座標が無くても全機能が正常に動作する（重複判定の座標ルールは
 * 座標が揃っている組み合わせでのみ発火する）。
 *
 * ── 将来 ────────────────────────────────────────────────────
 * 国土地理院ジオコーディング API などを使う場合は、この interface を
 * 実装したモジュールを追加して registry に登録するだけでよい。
 * 座標が入ると「住所表記が違っても座標が近い + 建物名が似ている」
 * ケースを重複候補として拾えるようになる。
 *
 * 取得ロジックを UI コンポーネント内に直接書いてはならない。
 * ────────────────────────────────────────────────────────────
 */

export type GeocodeLookup = {
  address: string;
  normalized_address: string;
  building_name?: string | null;
};

export type GeocodeResult = {
  latitude: number | null;
  longitude: number | null;
  /** 値の出所（監査用）。例: "gsi-geocoder" */
  source: string | null;
};

export type GeocodingAvailability =
  | { available: true }
  | { available: false; reason: string };

export interface GeocodingProvider {
  readonly id: string;
  readonly label: string;

  isAvailable(): GeocodingAvailability;

  /**
   * 複数件まとめて引く。取得できなかった住所は
   * { latitude: null, longitude: null } を返すこと。
   * 例外を投げず、必ず入力と同じ長さの配列を返す。
   */
  geocode(addresses: GeocodeLookup[]): Promise<GeocodeResult[]>;
}
