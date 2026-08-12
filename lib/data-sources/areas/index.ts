/**
 * 行政区域マスタ。
 *
 * ── 責務の分離 ──────────────────────────────────────────────
 * このマスタ    … 行政上どんなエリアが存在するか（東京都23区 など）
 * 各取得元      … そのうちどのエリアの建物データを取得できるか
 *
 * エリア選択のプルダウンはマスタから作るため、取得元が未対応の区も
 * 選択肢には出る。選んだ区に取得元が対応していない場合は、
 * その旨を画面に表示する（黙って空にしない）。
 * ────────────────────────────────────────────────────────────
 *
 * 東京都以外を追加するときは、areas/<都道府県>.ts を作って
 * AREA_MASTER に足すだけでよい。取得元・判定ロジック・UI は変更不要。
 */

import { TOKYO } from "./tokyo";
import type { CityMaster, PrefectureMaster } from "./types";

/** 対応している都道府県。追加はここに足すだけ。 */
export const AREA_MASTER: PrefectureMaster[] = [
  TOKYO,
  // 例: KANAGAWA, SAITAMA, CHIBA, ...
];

export function listPrefectures(): string[] {
  return AREA_MASTER.map((p) => p.name);
}

export function getPrefecture(name: string | null | undefined): PrefectureMaster | null {
  if (!name) return null;
  return AREA_MASTER.find((p) => p.name === name) ?? null;
}

/** 指定した都道府県の市区町村名。都道府県が未対応なら空配列 */
export function listCities(prefecture: string | null | undefined): string[] {
  return getPrefecture(prefecture)?.cities.map((c) => c.name) ?? [];
}

export function getCity(
  prefecture: string | null | undefined,
  city: string | null | undefined,
): CityMaster | null {
  if (!city) return null;
  return getPrefecture(prefecture)?.cities.find((c) => c.name === city) ?? null;
}

/** 市区町村コード（外部データソースとの突き合わせ用）。不明なら null */
export function getCityCode(
  prefecture: string | null | undefined,
  city: string | null | undefined,
): string | null {
  return getCity(prefecture, city)?.code ?? null;
}

export function getPrefectureCode(prefecture: string | null | undefined): string | null {
  return getPrefecture(prefecture)?.code ?? null;
}

/**
 * 市区町村名から都道府県を逆引きする。
 *
 * 「荒川区東日暮里3-12」のように都道府県が省略された住所を補うために使う。
 * 複数の都道府県に同名の市区町村がある場合は判断せず null を返す
 * （推測して間違えるより、不明のままにする）。
 */
export function findPrefectureByCity(city: string | null | undefined): string | null {
  if (!city) return null;

  const matches = AREA_MASTER.filter((p) => p.cities.some((c) => c.name === city));
  return matches.length === 1 ? matches[0].name : null;
}

/** マスタに存在するエリアかどうか */
export function isKnownArea(
  prefecture: string | null | undefined,
  city: string | null | undefined,
): boolean {
  return getCity(prefecture, city) !== null;
}

export { TOKYO, TOKYO_23_WARD_NAMES } from "./tokyo";
export type { AreaSelection, CityMaster, PrefectureMaster } from "./types";
