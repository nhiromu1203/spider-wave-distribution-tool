/**
 * 行政区域マスタの型。
 *
 * 都道府県 → 市区町村 → 町丁目 の 3 階層で扱う。
 * 町丁目は数が多く変動もあるため、マスタには持たせず
 * 「取得元が列挙する」か「取り込み済みのデータから拾う」ことで解決する。
 */

export type CityMaster = {
  /** 市区町村名。例「荒川区」 */
  name: string;
  /** 読み。並び替え・検索用 */
  kana: string;
  /** 全国地方公共団体コード（5桁）。外部データソースとの突き合わせに使う */
  code: string;
};

export type PrefectureMaster = {
  /** 都道府県名。例「東京都」 */
  name: string;
  kana: string;
  /** 都道府県コード（2桁） */
  code: string;
  cities: CityMaster[];
};

/** 町丁目まで指定したエリア */
export type AreaSelection = {
  prefecture: string;
  city: string;
  town?: string | null;
};
