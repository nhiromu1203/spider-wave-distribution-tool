/**
 * 住所の正規化。
 *
 * 重複判定における最優先キーは住所であり、この関数の出力
 * (normalized_address) が完全一致した場合は同一物件とみなす。
 *
 * 元の住所文字列は呼び出し側で必ず保持すること。ここでは比較用の
 * 派生値だけを作る。
 *
 *   東京都荒川区東日暮里1丁目5番3号
 *   東京都荒川区東日暮里1-5-3
 *   荒川区東日暮里１－５－３
 *   荒川区 東日暮里 1-5-3
 *     → すべて "荒川区東日暮里1-5-3"
 */

import { KANJI_DIGITS } from "./dictionaries";

const PREFECTURE_RE = /^(北海道|東京都|京都府|大阪府|[^\s]{2,3}県)/;

/** 住所として意味を持たない記号 */
const PUNCTUATION_RE =
  /[\s　,.、。，．・･:：;；'"'"`|/\\_~^*!?()（）「」『』【】〔〕［］\[\]｛｝{}<>＜＞〒#＃@＠&＆+＋=＝]/g;

export type NormalizedAddress = {
  /** 比較に使う正規化済み住所（丁目・番・号を "-" に統一した形） */
  normalized: string;
  /** 住所末尾に混入していた建物名・部屋番号などの残余 */
  extra: string;
  /** 数字より前の部分（市区町村＋町名） */
  locality: string;
  /** 街区符号の列。例: "1-5-3" → [1, 5, 3] */
  blocks: number[];
  /** 元の住所に都道府県が含まれていた場合はその名称 */
  prefecture: string | null;
};

/** 漢数字の並びをアラビア数字へ（1〜99 の範囲を想定） */
function kanjiRunToNumber(run: string): number | null {
  if (run.length === 0) return null;

  // 十を含む場合の組み立て（十, 二十, 十五, 二十三 …）
  const tenIndex = run.indexOf("十");
  if (tenIndex >= 0) {
    const head = run.slice(0, tenIndex);
    const tail = run.slice(tenIndex + 1);
    const tens = head === "" ? 1 : KANJI_DIGITS[head];
    const ones = tail === "" ? 0 : KANJI_DIGITS[tail];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }

  let value = 0;
  for (const ch of run) {
    const digit = KANJI_DIGITS[ch];
    if (digit === undefined) return null;
    value = value * 10 + digit;
  }
  return value;
}

/**
 * 丁目・番地・番・号・条の直前に置かれた漢数字だけをアラビア数字へ置換する。
 * 「三軒茶屋」のような地名の漢数字は対象外。
 */
function convertKanjiNumerals(input: string): string {
  return input.replace(
    /([〇零一二三四五六七八九十]+)(?=丁目|丁|番地|番|号|条)/g,
    (match) => {
      const n = kanjiRunToNumber(match);
      return n === null ? match : String(n);
    },
  );
}

/** 住所文字列を正規化して構造化する */
export function normalizeAddressDetailed(input: string | null | undefined): NormalizedAddress {
  const empty: NormalizedAddress = {
    normalized: "",
    extra: "",
    locality: "",
    blocks: [],
    prefecture: null,
  };
  if (!input) return empty;

  // 1. 全角英数字・全角記号 → 半角（NFKC）
  let s = input.normalize("NFKC");

  // 2. 各種ダッシュ・長音符を半角ハイフンへ統一
  s = s.replace(/[‐‑‒–—―ー−ｰ－ー]/g, "-");

  // 3. 前後の空白を落としつつ、都道府県を検出して取り除く
  s = s.replace(/^\s+|\s+$/g, "");
  const prefMatch = s.match(PREFECTURE_RE);
  const prefecture = prefMatch ? prefMatch[1] : null;
  if (prefMatch) s = s.slice(prefMatch[1].length);

  // 4. 「大字」「小字」など住所比較上ノイズになる語を除去
  s = s.replace(/大字|小字/g, "");

  // 5. 丁目・番・号の前の漢数字をアラビア数字へ
  s = convertKanjiNumerals(s);

  // 6. 丁目・番地・番・号・条 を "-" へ統一（数字に続く場合のみ）
  s = s
    .replace(/(\d+)\s*丁目/g, "$1-")
    .replace(/(\d+)\s*番地/g, "$1-")
    .replace(/(\d+)\s*番/g, "$1-")
    .replace(/(\d+)\s*号室/g, "$1-")
    .replace(/(\d+)\s*号/g, "$1-")
    .replace(/(\d+)\s*条/g, "$1-");

  // 7. 空白・不要記号の除去、英字は小文字へ
  s = s.replace(PUNCTUATION_RE, "").toLowerCase();

  // 8. ハイフンの重複・前後の余分を整理
  s = s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");

  // 9. 「町名 + 街区符号 + 残余」に分解する
  const structured = s.match(/^(\D*?)(\d+(?:-\d+)*)(.*)$/);
  if (!structured) {
    return { normalized: s, extra: "", locality: s, blocks: [], prefecture };
  }

  const [, locality, blockPart, remainder] = structured;
  const blocks = blockPart.split("-").map(Number);

  // 残余が数字やハイフンで始まる場合は住所の続き（例: 札幌の「北12-西4-1」）
  // とみなし、切り離さない。建物名らしき文字で始まる場合のみ extra とする。
  const isBuildingLike = remainder.length > 0 && !/^[-\d]/.test(remainder);

  if (!isBuildingLike) {
    return {
      normalized: s,
      extra: "",
      locality,
      blocks,
      prefecture,
    };
  }

  return {
    normalized: `${locality}${blockPart}`,
    extra: remainder,
    locality,
    blocks,
    prefecture,
  };
}

/** 比較用の正規化住所だけを取り出す簡易版 */
export function normalizeAddress(input: string | null | undefined): string {
  return normalizeAddressDetailed(input).normalized;
}

export type AddressParts = {
  prefecture: string | null;
  city: string | null;
  town: string | null;
};

/**
 * 住所を 都道府県 / 市区町村 / 町名 に分解する（検索フィルタ用）。
 * 分解できない部分は null を返し、推測はしない。
 */
export function parseAddressParts(input: string | null | undefined): AddressParts {
  if (!input) return { prefecture: null, city: null, town: null };

  let s = input.normalize("NFKC").replace(/[\s　]/g, "");

  const prefMatch = s.match(PREFECTURE_RE);
  const prefecture = prefMatch ? prefMatch[1] : null;
  if (prefMatch) s = s.slice(prefMatch[1].length);

  // 郡は単体では市区町村にならないため、後続の町/村までをひとまとまりにする
  const cityMatch = s.match(/^(.+?郡.+?[町村]|.+?[市区町村])/);
  const city = cityMatch ? cityMatch[1] : null;
  if (cityMatch) s = s.slice(cityMatch[1].length);

  // 町名は最初の数字（丁目を含む）の手前まで
  const townMatch = s.match(/^([^\d〇零一二三四五六七八九十]+?)(?=[\d〇零一二三四五六七八九十]|$)/);
  const town = townMatch && townMatch[1] ? townMatch[1] : null;

  return { prefecture, city, town };
}
