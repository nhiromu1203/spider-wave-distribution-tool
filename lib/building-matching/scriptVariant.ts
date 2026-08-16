/**
 * 同じ建物を、日本語表記と英語表記など「文字種違い」で書いたものかを判定する。
 *
 * ── 類似度では判別できない ──────────────────────────────────
 * 実測（lib/building-matching の calculateNameSimilarity）:
 *
 *   グランドメゾン中野 / GRAND MAISON NAKANO   0.854  ← 同じ建物
 *   パークハウス東中野 / PARK HOUSE HIGASHI…   0.873  ← 同じ建物
 *   グランドメゾン中野 / グランドメゾン新宿     0.950  ← 別の建物
 *   コスモステージ… S棟 / … N棟               0.947  ← 別の建物
 *   ノーザンスクエア / サザンスクエア           0.818  ← 別の建物
 *
 * 同じ建物より別の建物のほうが高く出るため、しきい値では切り分けられない。
 * そこで「書かれている文字の種類が違うこと」を条件にする。
 *
 * ローマ字へ寄せたうえで一定以上似ていて、かつ元の文字種が異なる場合だけ
 * 表記違いとみなす。同じ文字種どうし（カタカナ同士・漢字同士）は、
 * どれだけ似ていても別の建物として扱う。
 * ────────────────────────────────────────────────────────────
 */

import { calculateNameSimilarity } from "./calculateNameSimilarity";

/** 表記違いとみなす最低スコア。実測の日英表記は 0.80 以上だった */
const MIN_SCORE = 0.8;

export type ScriptKind = "latin" | "japanese" | "mixed" | "empty";

/** 建物名がどの文字種で書かれているかを見る */
export function detectScript(name: string): ScriptKind {
  const s = name.normalize("NFKC");
  const hasLatin = /[A-Za-z]/.test(s);
  // ひらがな・カタカナ・漢字
  const hasJapanese = /[぀-ゟ゠-ヿ一-鿿]/.test(s);

  if (!hasLatin && !hasJapanese) return "empty";
  if (hasLatin && hasJapanese) return "mixed";
  return hasLatin ? "latin" : "japanese";
}

/**
 * 同じ建物を違う文字種で書いたものか。
 *
 * これだけで配布済みと判断してはいけない。住所が一致していることを
 * 呼び出し側で必ず確かめること。住所が違えば、名前が似ていても
 * 別の建物である可能性が高い。
 */
export function isScriptVariant(a: string, b: string): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left || !right) return false;

  const scriptA = detectScript(left);
  const scriptB = detectScript(right);
  if (scriptA === "empty" || scriptB === "empty") return false;

  // 同じ文字種で書かれているなら、表記違いではなく別の名前。
  // 「グランドメゾン中野」と「グランドメゾン新宿」を同じにしないための線引き。
  if (scriptA === scriptB) return false;

  // ローマ字へ寄せたうえで十分に似ていること
  return calculateNameSimilarity(left, right).score >= MIN_SCORE;
}
