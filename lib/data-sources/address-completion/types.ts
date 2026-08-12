/**
 * 座標から住所を補完する仕組み。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * OpenStreetMap の建物ポリゴンには住所タグがほとんど付いていない。
 * 荒川区の building=apartments 460 件のうち、住所を組み立てられたのは
 * 12 件（2.6%）だけだった。一方で座標は 460 件すべてに付いている。
 * そこで座標から住所を引き当てて補う。
 *
 * ── 設計 ────────────────────────────────────────────────────
 * BuildingDataSource とは完全に分離する。取得元が OSM でも他でも、
 * 「座標はあるが住所が無い建物」を同じ手順で補完できるようにする。
 * 補完元（provider）は差し替え可能で、registry に追加するだけで切り替わる。
 * ────────────────────────────────────────────────────────────
 */

export type LatLon = {
  latitude: number;
  longitude: number;
};

/** 補完した住所の粒度 */
export type AddressPrecision =
  /** 住居番号まで揃っている（例: 荒川区東日暮里1-5-3） */
  | "housenumber"
  /** 街区符号まで（例: 荒川区東日暮里1-5）。住居番号は含まない */
  | "block"
  /** 町丁目まで（例: 荒川区東日暮里1丁目） */
  | "town";

export type CompletedAddress = {
  /** 組み立てた住所文字列 */
  address: string;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  precision: AddressPrecision;
  /** どのデータで補完したか（"isj" など） */
  source: string;
  /** 参照した基準点までの距離（m）。近いほど確度が高い */
  distanceMeters: number;
};

export type CompletionAvailability =
  | { available: true }
  | { available: false; reason: string };

export interface AddressCompletionProvider {
  readonly id: string;
  readonly label: string;
  /** 補完できる住所の粒度 */
  readonly precision: AddressPrecision;

  isAvailable(): CompletionAvailability;

  /** 対応している都道府県かどうか */
  supportsPrefecture(prefecture: string): boolean;

  /**
   * 座標をまとめて住所へ変換する。
   *
   * 入力と同じ長さの配列を返し、補完できなかった点は null にする。
   * 1 件ずつ外部 API を呼ぶ実装にしてはならない
   * （運用コストと速度の問題があるため、ローカルデータで解決する）。
   */
  complete(
    points: LatLon[],
    context: { prefecture: string; city?: string | null },
  ): Promise<Array<CompletedAddress | null>>;
}

/** 住所の出所。補完したものか、取得元が最初から持っていたものか */
export type AddressSource = "source" | string;

/** 取得元が最初から住所を持っていた場合の値 */
export const ADDRESS_SOURCE_ORIGINAL = "source";
