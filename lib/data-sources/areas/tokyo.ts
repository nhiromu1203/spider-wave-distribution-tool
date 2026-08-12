/**
 * 東京都の行政区域マスタ。
 *
 * ここは「行政上どんなエリアが存在するか」を表すデータであり、
 * 「どのエリアの建物データを取得できるか」（取得元の対応範囲）とは別物。
 * エリア選択のプルダウンはこのマスタから作り、取得可否は取得元が判断する。
 */

import type { CityMaster, PrefectureMaster } from "./types";

/** 東京都特別区（23区）。code は全国地方公共団体コード（5桁） */
const TOKYO_WARDS: CityMaster[] = [
  { name: "千代田区", kana: "ちよだく", code: "13101" },
  { name: "中央区", kana: "ちゅうおうく", code: "13102" },
  { name: "港区", kana: "みなとく", code: "13103" },
  { name: "新宿区", kana: "しんじゅくく", code: "13104" },
  { name: "文京区", kana: "ぶんきょうく", code: "13105" },
  { name: "台東区", kana: "たいとうく", code: "13106" },
  { name: "墨田区", kana: "すみだく", code: "13107" },
  { name: "江東区", kana: "こうとうく", code: "13108" },
  { name: "品川区", kana: "しながわく", code: "13109" },
  { name: "目黒区", kana: "めぐろく", code: "13110" },
  { name: "大田区", kana: "おおたく", code: "13111" },
  { name: "世田谷区", kana: "せたがやく", code: "13112" },
  { name: "渋谷区", kana: "しぶやく", code: "13113" },
  { name: "中野区", kana: "なかのく", code: "13114" },
  { name: "杉並区", kana: "すぎなみく", code: "13115" },
  { name: "豊島区", kana: "としまく", code: "13116" },
  { name: "北区", kana: "きたく", code: "13117" },
  { name: "荒川区", kana: "あらかわく", code: "13118" },
  { name: "板橋区", kana: "いたばしく", code: "13119" },
  { name: "練馬区", kana: "ねりまく", code: "13120" },
  { name: "足立区", kana: "あだちく", code: "13121" },
  { name: "葛飾区", kana: "かつしかく", code: "13122" },
  { name: "江戸川区", kana: "えどがわく", code: "13123" },
];

export const TOKYO: PrefectureMaster = {
  name: "東京都",
  kana: "とうきょうと",
  code: "13",
  cities: TOKYO_WARDS,
};

/** 23区の区名だけを取り出す */
export const TOKYO_23_WARD_NAMES: string[] = TOKYO_WARDS.map((w) => w.name);
