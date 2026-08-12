/**
 * カタカナ / ひらがな ⇄ ローマ字 の変換と、ローマ字表記の揺れ吸収。
 *
 * 目的は「厳密な翻字」ではなく、
 *   グランドメゾン ≒ GRAND MAISON
 * のような表記違いを同じ土俵に載せることにある。
 */

const DIGRAPHS: Record<string, string> = {
  キャ: "kya", キュ: "kyu", キョ: "kyo", キェ: "kye",
  ギャ: "gya", ギュ: "gyu", ギョ: "gyo", ギェ: "gye",
  シャ: "sha", シュ: "shu", ショ: "sho", シェ: "she",
  ジャ: "ja", ジュ: "ju", ジョ: "jo", ジェ: "je",
  チャ: "cha", チュ: "chu", チョ: "cho", チェ: "che",
  ニャ: "nya", ニュ: "nyu", ニョ: "nyo",
  ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo",
  ビャ: "bya", ビュ: "byu", ビョ: "byo",
  ピャ: "pya", ピュ: "pyu", ピョ: "pyo",
  ミャ: "mya", ミュ: "myu", ミョ: "myo",
  リャ: "rya", リュ: "ryu", リョ: "ryo",
  ファ: "fa", フィ: "fi", フェ: "fe", フォ: "fo", フュ: "fyu",
  ヴァ: "va", ヴィ: "vi", ヴェ: "ve", ヴォ: "vo", ヴュ: "vyu",
  ウィ: "wi", ウェ: "we", ウォ: "wo",
  ティ: "ti", トゥ: "tu", テュ: "tyu",
  ディ: "di", ドゥ: "du", デュ: "dyu",
  ツァ: "tsa", ツィ: "tsi", ツェ: "tse", ツォ: "tso",
  クァ: "kwa", クィ: "kwi", クェ: "kwe", クォ: "kwo",
  グァ: "gwa",
};

const MONOGRAPHS: Record<string, string> = {
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
  ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
  ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
  ワ: "wa", ヰ: "i", ヱ: "e", ヲ: "o", ン: "n",
  ヴ: "vu",
  ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o",
  ャ: "ya", ュ: "yu", ョ: "yo", ヮ: "wa",
};

const KATAKANA_RE = /[゠-ヿㇰ-ㇿ]/;
const LATIN_RE = /[A-Za-z]/;

export function isKatakana(ch: string): boolean {
  return KATAKANA_RE.test(ch);
}

export function isLatin(ch: string): boolean {
  return LATIN_RE.test(ch);
}

/** ひらがな → カタカナ */
export function hiraganaToKatakana(input: string): string {
  return input.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60),
  );
}

/**
 * カタカナ表記の揺れを吸収する。
 * ヴァ→バ / ヷ→バ など、日本語話者が同じ音として扱う差を潰す。
 */
export function normalizeKatakana(input: string): string {
  return hiraganaToKatakana(input)
    .replace(/ヷ/g, "バ")
    .replace(/ヸ/g, "ビ")
    .replace(/ヹ/g, "ベ")
    .replace(/ヺ/g, "ボ")
    .replace(/ヴァ/g, "バ")
    .replace(/ヴィ/g, "ビ")
    .replace(/ヴェ/g, "ベ")
    .replace(/ヴォ/g, "ボ")
    .replace(/ヴ/g, "ブ")
    .replace(/[ヽヾゝゞ]/g, "");
}

/** カタカナ → ローマ字（ヘボン式ベース） */
export function katakanaToRomaji(input: string): string {
  const src = normalizeKatakana(input);
  let out = "";
  let i = 0;

  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (DIGRAPHS[two]) {
      out += DIGRAPHS[two];
      i += 2;
      continue;
    }

    const ch = src[i];

    // 促音: 次の音の子音を重ねる
    if (ch === "ッ") {
      const nextTwo = src.slice(i + 1, i + 3);
      const nextOne = src[i + 1] ?? "";
      const next = DIGRAPHS[nextTwo] ?? MONOGRAPHS[nextOne] ?? "";
      const consonant = next.match(/^[bcdfghjklmnpqrstvwxyz]/)?.[0];
      if (consonant) out += consonant === "c" ? "t" : consonant;
      i += 1;
      continue;
    }

    // 長音符は落とす（後段で長音正規化するため、ここで消しても等価）
    if (ch === "ー" || ch === "－" || ch === "-") {
      i += 1;
      continue;
    }

    if (MONOGRAPHS[ch]) {
      out += MONOGRAPHS[ch];
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * ローマ字 / 英単語の表記揺れを吸収し、比較可能な形へ寄せる。
 *
 *   gurando / grand / GURANDO → 同じ土俵
 *   toukyou / tokyo / tookyoo → tokyo
 */
export function normalizeRomaji(input: string): string {
  let s = input.toLowerCase().replace(/[^a-z0-9]/g, "");

  // 長音の各種表記を潰す
  s = s.replace(/ou/g, "o").replace(/oh(?=[bcdfghjklmnpqrstvwxyz])/g, "o");
  s = s.replace(/([aiueo])\1+/g, "$1");

  // 撥音・子音の揺れ
  s = s.replace(/n(?=[bmp])/g, "m");
  s = s.replace(/l/g, "r");
  s = s.replace(/v/g, "b");
  s = s.replace(/c(?=[eiy])/g, "s").replace(/ck/g, "k").replace(/c/g, "k");
  s = s.replace(/q/g, "k").replace(/x/g, "ks");
  s = s.replace(/sh/g, "s").replace(/ch/g, "t").replace(/ts/g, "t");
  s = s.replace(/j/g, "z");
  s = s.replace(/ph/g, "f");
  s = s.replace(/wh/g, "w");

  // 促音・重子音を1つに
  s = s.replace(/([bcdfghjkmprstwyz])\1+/g, "$1");

  // 語末の曖昧母音（gurando の -o、koto の -o など）は残す。
  // 消すと別語と衝突しやすいため、比較側は子音スケルトンで吸収する。
  return s;
}

/**
 * 母音を除いた子音スケルトン。
 * 「gurando」と「grand」のような、日本語式ローマ字と英語綴りの差を吸収する。
 */
export function consonantSkeleton(romaji: string): string {
  return romaji.replace(/[aiueo]/g, "");
}
