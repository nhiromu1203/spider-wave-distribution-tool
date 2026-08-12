/**
 * 建物名の語彙辞書。
 *
 * 「グランドメゾン」と「GRAND MAISON」、「日暮里」と「NIPPORI」のように
 * 漢字 / カタカナ / ローマ字 / 英語で表記が分かれる語を、
 * 1つの canonical トークンへ寄せるための対応表。
 *
 * ここは運用しながら育てる想定のデータファイル。
 * 語を追加するだけで判定精度が上がり、ロジック側の変更は不要。
 */

export type LexiconEntry = {
  /** 正規化後のトークン名 */
  canonical: string;
  /** 表記ゆれ。漢字・カタカナ・ローマ字・英語をすべて列挙する */
  forms: string[];
};

/** 建物名によく使われる語（種別・シリーズ名など） */
const BUILDING_WORDS: LexiconEntry[] = [
  { canonical: "grand", forms: ["グランド", "グラン", "grand", "gran", "gurando", "guran"] },
  { canonical: "maison", forms: ["メゾン", "メイゾン", "maison", "mezon", "meison", "maisons"] },
  { canonical: "court", forms: ["コート", "コウト", "court", "kohto", "koto", "courts"] },
  { canonical: "heights", forms: ["ハイツ", "heights", "height", "haitsu"] },
  { canonical: "heim", forms: ["ハイム", "heim", "haimu"] },
  { canonical: "haus", forms: ["ハウス", "ハオス", "house", "haus", "hausu"] },
  { canonical: "palace", forms: ["パレス", "パラス", "palace", "paresu", "palais"] },
  { canonical: "residence", forms: ["レジデンス", "レジデンシャル", "residence", "residencia", "rejidensu", "residential"] },
  { canonical: "tower", forms: ["タワー", "tower", "tawa"] },
  { canonical: "park", forms: ["パーク", "park", "paku", "parc"] },
  { canonical: "garden", forms: ["ガーデン", "ガーデンズ", "garden", "gardens", "gaden"] },
  { canonical: "hills", forms: ["ヒルズ", "ヒル", "hills", "hill", "hiruzu"] },
  { canonical: "plaza", forms: ["プラザ", "ぷらざ", "plaza", "puraza"] },
  { canonical: "corpo", forms: ["コーポ", "コーポラス", "corpo", "kopo", "corpolus"] },
  { canonical: "villa", forms: ["ヴィラ", "ビラ", "ヴィレッジ", "villa", "vila", "bira", "village"] },
  { canonical: "city", forms: ["シティ", "シティー", "city", "shiti"] },
  { canonical: "stage", forms: ["ステージ", "stage", "suteji"] },
  { canonical: "square", forms: ["スクエア", "スクウェア", "square", "sukuea"] },
  { canonical: "terrace", forms: ["テラス", "terrace", "terasu"] },
  { canonical: "flat", forms: ["フラット", "flat", "furatto"] },
  { canonical: "front", forms: ["フロント", "front", "furonto"] },
  { canonical: "avenue", forms: ["アベニュー", "avenue", "abenyu"] },
  { canonical: "street", forms: ["ストリート", "street", "sutorito"] },
  { canonical: "side", forms: ["サイド", "side", "saido"] },
  { canonical: "view", forms: ["ビュー", "ヴュー", "view", "byu"] },
  { canonical: "forest", forms: ["フォレスト", "forest", "foresuto"] },
  { canonical: "green", forms: ["グリーン", "green", "gurin"] },
  { canonical: "blue", forms: ["ブルー", "blue", "buru"] },
  { canonical: "white", forms: ["ホワイト", "white", "howaito"] },
  { canonical: "royal", forms: ["ロイヤル", "ロイアル", "royal", "roiyaru"] },
  { canonical: "premium", forms: ["プレミアム", "premium", "puremiamu"] },
  { canonical: "central", forms: ["セントラル", "central", "sentoraru"] },
  { canonical: "station", forms: ["ステーション", "station", "suteshon"] },
  { canonical: "sunrise", forms: ["サンライズ", "sunrise", "sanraizu"] },
  { canonical: "sunshine", forms: ["サンシャイン", "sunshine", "sanshain"] },
  { canonical: "sun", forms: ["サン", "sun", "san"] },
  { canonical: "casa", forms: ["カーサ", "casa", "kasa"] },
  { canonical: "belle", forms: ["ベル", "ベール", "belle", "bell", "beru"] },
  { canonical: "ville", forms: ["ヴィル", "ビル", "ville", "biru"] },
  { canonical: "courtyard", forms: ["コートヤード", "courtyard", "kotoyado"] },
  { canonical: "mansion", forms: ["マンション", "mansion", "manshon"] },
  { canonical: "apartment", forms: ["アパート", "アパートメント", "apartment", "apart", "apato"] },
  { canonical: "building", forms: ["ビルディング", "building", "bldg", "birudingu"] },
  { canonical: "annex", forms: ["アネックス", "annex", "anekkusu"] },
  { canonical: "so", forms: ["荘", "ソウ", "sou"] },
  { canonical: "kaikan", forms: ["会館", "kaikan"] },
  { canonical: "kan", forms: ["館", "カン"] },
  { canonical: "daiichi", forms: ["第一", "ダイイチ", "daiichi", "daiiti"] },
  { canonical: "daini", forms: ["第二", "ダイニ", "daini"] },
  { canonical: "daisan", forms: ["第三", "ダイサン", "daisan"] },
  { canonical: "higashi", forms: ["東", "ヒガシ", "higashi", "east"] },
  { canonical: "nishi", forms: ["西", "ニシ", "nishi", "west"] },
  { canonical: "minami", forms: ["南", "ミナミ", "minami", "south"] },
  { canonical: "kita", forms: ["北", "キタ", "kita", "north"] },
  { canonical: "chuo", forms: ["中央", "チュウオウ", "chuo", "chuou"] },
  { canonical: "shin", forms: ["新", "シン", "shin"] },
  { canonical: "hon", forms: ["本", "ホン", "hon"] },
];

/**
 * 地名（建物名の一部として頻出）。
 * 対象エリアが増えたらここに追記していく。
 */
const PLACE_NAMES: LexiconEntry[] = [
  { canonical: "nippori", forms: ["日暮里", "ニッポリ", "nippori", "nipori"] },
  { canonical: "arakawa", forms: ["荒川", "アラカワ", "arakawa"] },
  { canonical: "minowa", forms: ["三ノ輪", "三の輪", "ミノワ", "minowa"] },
  { canonical: "machiya", forms: ["町屋", "マチヤ", "machiya"] },
  { canonical: "ogu", forms: ["尾久", "オグ", "ogu"] },
  { canonical: "senju", forms: ["千住", "センジュ", "senju"] },
  { canonical: "ueno", forms: ["上野", "ウエノ", "ueno"] },
  { canonical: "asakusa", forms: ["浅草", "アサクサ", "asakusa"] },
  { canonical: "ikebukuro", forms: ["池袋", "イケブクロ", "ikebukuro"] },
  { canonical: "shinjuku", forms: ["新宿", "シンジュク", "shinjuku"] },
  { canonical: "shibuya", forms: ["渋谷", "シブヤ", "shibuya"] },
  { canonical: "tokyo", forms: ["東京", "トウキョウ", "tokyo", "toukyou"] },
  { canonical: "akihabara", forms: ["秋葉原", "アキハバラ", "akihabara"] },
  { canonical: "kanda", forms: ["神田", "カンダ", "kanda"] },
  { canonical: "sugamo", forms: ["巣鴨", "スガモ", "sugamo"] },
  { canonical: "oji", forms: ["王子", "オウジ", "oji", "ouji"] },
  { canonical: "tabata", forms: ["田端", "タバタ", "tabata"] },
  { canonical: "komagome", forms: ["駒込", "コマゴメ", "komagome"] },
  { canonical: "yanaka", forms: ["谷中", "ヤナカ", "yanaka"] },
  { canonical: "kitasenju", forms: ["北千住", "キタセンジュ", "kitasenju"] },
];

export const LEXICON: LexiconEntry[] = [...BUILDING_WORDS, ...PLACE_NAMES];

/** 表記 → canonical の逆引き表（長い表記から順に引くため配列で保持） */
export type LexiconIndex = {
  /** 表記の長さ降順に並んだ [form, canonical] */
  entries: Array<[string, string]>;
  maxFormLength: number;
};

function buildIndex(lexicon: LexiconEntry[]): LexiconIndex {
  const map = new Map<string, string>();
  for (const entry of lexicon) {
    for (const form of entry.forms) {
      const key = form.toLowerCase();
      // 先に登録された（= より前のエントリの）定義を優先する
      if (!map.has(key)) map.set(key, entry.canonical);
    }
  }
  const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  return {
    entries,
    maxFormLength: entries.length > 0 ? entries[0][0].length : 0,
  };
}

export const LEXICON_INDEX: LexiconIndex = buildIndex(LEXICON);

/** 漢数字 → アラビア数字（住所の丁目・番・号で使う範囲） */
export const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 建物名から取り除く一般語（付いていても別建物とは限らない） */
export const NOISE_TOKENS = new Set([
  "mansion",
  "apartment",
  "building",
]);
