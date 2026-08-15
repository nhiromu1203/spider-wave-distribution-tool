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
  { name: "千代田区", slug: "chiyoda-city", kana: "ちよだく", code: "13101" },
  { name: "中央区", slug: "chuo-city", kana: "ちゅうおうく", code: "13102" },
  { name: "港区", slug: "minato-city", kana: "みなとく", code: "13103" },
  { name: "新宿区", slug: "shinjuku-city", kana: "しんじゅくく", code: "13104" },
  { name: "文京区", slug: "bunkyo-city", kana: "ぶんきょうく", code: "13105" },
  { name: "台東区", slug: "taito-city", kana: "たいとうく", code: "13106" },
  { name: "墨田区", slug: "sumida-city", kana: "すみだく", code: "13107" },
  { name: "江東区", slug: "koto-city", kana: "こうとうく", code: "13108" },
  { name: "品川区", slug: "shinagawa-city", kana: "しながわく", code: "13109" },
  { name: "目黒区", slug: "meguro-city", kana: "めぐろく", code: "13110" },
  { name: "大田区", slug: "ota-city", kana: "おおたく", code: "13111" },
  { name: "世田谷区", slug: "setagaya-city", kana: "せたがやく", code: "13112" },
  { name: "渋谷区", slug: "shibuya-city", kana: "しぶやく", code: "13113" },
  { name: "中野区", slug: "nakano-city", kana: "なかのく", code: "13114" },
  { name: "杉並区", slug: "suginami-city", kana: "すぎなみく", code: "13115" },
  { name: "豊島区", slug: "toshima-city", kana: "としまく", code: "13116" },
  { name: "北区", slug: "kita-city", kana: "きたく", code: "13117" },
  { name: "荒川区", slug: "arakawa-city", kana: "あらかわく", code: "13118" },
  { name: "板橋区", slug: "itabashi-city", kana: "いたばしく", code: "13119" },
  { name: "練馬区", slug: "nerima-city", kana: "ねりまく", code: "13120" },
  { name: "足立区", slug: "adachi-city", kana: "あだちく", code: "13121" },
  { name: "葛飾区", slug: "katsushika-city", kana: "かつしかく", code: "13122" },
  { name: "江戸川区", slug: "edogawa-city", kana: "えどがわく", code: "13123" },
];

export const TOKYO: PrefectureMaster = {
  name: "東京都",
  kana: "とうきょうと",
  code: "13",
  cities: TOKYO_WARDS,
};

/** 23区の区名だけを取り出す */
export const TOKYO_23_WARD_NAMES: string[] = TOKYO_WARDS.map((w) => w.name);
