/**
 * 建物名の正規化とトークン化。
 *
 * 建物名は「補助的な」判定材料である。住所が明確に違う場合、
 * 建物名がどれだけ似ていても同一物件と判断してはならない
 * （同名の建物が別住所に存在しうるため）。
 */

import { LEXICON_INDEX, NOISE_TOKENS } from "./dictionaries";
import {
  consonantSkeleton,
  isLatin,
  katakanaToRomaji,
  normalizeKatakana,
  normalizeRomaji,
} from "./transliterate";

/** 建物名として意味を持たない記号 */
const PUNCTUATION_RE =
  /[\s　,.、。，．・･:：;；'"'"`|/\\_~^*!?＆&＠@#＃$＄%％()（）「」『』【】〔〕［］\[\]｛｝{}<>＜＞+＋=＝\-‐‑‒–—―−]/g;

/** 末尾に付く棟名・部屋番号など、同一建物内の差異を表す表記 */
const UNIT_SUFFIX_RE = /(\d+号室|\d+号棟|[a-z]?\d+棟|\d+f|b\d+f)$/;

export type NormalizedBuildingName = {
  /** 比較用に正規化した建物名 */
  normalized: string;
  /** 辞書で canonical 化したトークン列 */
  tokens: string[];
  /** トークン列を連結した比較用文字列 */
  canonical: string;
  /** 母音を除いた子音スケルトン（ローマ字/英語の綴り差を吸収） */
  skeleton: string;
};

/**
 * 表層の正規化。
 * カタカナは長音符を保持したまま残す（後段の翻字で使うため）。
 */
function normalizeSurface(input: string): string {
  let s = input.normalize("NFKC");

  // NFKC で半角カタカナは全角化される。濁点・半濁点の合成もここで済ませる
  s = s.normalize("NFC");

  s = normalizeKatakana(s);
  s = s.replace(PUNCTUATION_RE, "");
  s = s.toLowerCase();
  s = s.replace(UNIT_SUFFIX_RE, "");

  return s;
}

/**
 * 正規化済み文字列を、辞書とローマ字化を使って canonical トークン列へ分解する。
 *
 *   "グランドメゾン日暮里"  → ["grand", "maison", "nippori"]
 *   "grandmaisonnippori"   → ["grand", "maison", "nippori"]
 */
function tokenize(normalized: string): string[] {
  const tokens: string[] = [];
  let buffer = "";

  const flushBuffer = () => {
    if (!buffer) return;
    // 辞書に載らなかった部分。カタカナならローマ字化して寄せる
    const romaji = /[゠-ヿ]/.test(buffer)
      ? normalizeRomaji(katakanaToRomaji(buffer))
      : normalizeRomaji(buffer);
    const value = romaji || buffer;
    if (value) tokens.push(value);
    buffer = "";
  };

  let i = 0;
  while (i < normalized.length) {
    let matched: string | null = null;
    let matchedLength = 0;

    // 最長一致で辞書を引く
    const maxLen = Math.min(LEXICON_INDEX.maxFormLength, normalized.length - i);
    for (const [form, canonical] of LEXICON_INDEX.entries) {
      if (form.length > maxLen) continue;
      // ラテン文字の短い表記は誤マッチしやすいので 3 文字以上に限定する
      if (form.length < 3 && isLatin(form[0])) continue;
      if (normalized.startsWith(form, i)) {
        matched = canonical;
        matchedLength = form.length;
        break;
      }
    }

    if (matched) {
      flushBuffer();
      tokens.push(matched);
      i += matchedLength;
      continue;
    }

    buffer += normalized[i];
    i += 1;
  }
  flushBuffer();

  return tokens.filter((t) => t.length > 0 && !NOISE_TOKENS.has(t));
}

export function normalizeBuildingNameDetailed(
  input: string | null | undefined,
): NormalizedBuildingName {
  if (!input) {
    return { normalized: "", tokens: [], canonical: "", skeleton: "" };
  }

  const normalized = normalizeSurface(input);
  const tokens = tokenize(normalized);
  const canonical = tokens.join("");

  // スケルトンはローマ字化した全体から作る（辞書非依存の保険）
  const wholeRomaji = /[゠-ヿ]/.test(normalized)
    ? normalizeRomaji(katakanaToRomaji(normalized))
    : normalizeRomaji(normalized);

  return {
    normalized,
    tokens,
    canonical,
    skeleton: consonantSkeleton(wholeRomaji || canonical),
  };
}

/** DB の normalized_building_name に保存する値 */
export function normalizeBuildingName(input: string | null | undefined): string {
  return normalizeBuildingNameDetailed(input).normalized;
}
