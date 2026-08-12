/**
 * 住所同士の類似度算出。
 *
 * 単純な文字列類似度は使わない。
 * 「東日暮里」と「西日暮里」は文字列としては 75% 似ているが別の町であり、
 * ここを取り違えると二重配布ではなく「配布漏れ」を生む。
 * そのため 町名部分 と 街区符号 を分けて評価する。
 */

import { normalizeAddressDetailed, type NormalizedAddress } from "./normalizeAddress";
import { levenshteinRatio, round4 } from "./similarity";

/** 街区符号の関係 */
export type BlockRelation =
  /** 完全に同じ */
  | "equal"
  /** 一方が他方の前方一致（例: 3-12 と 3-12-5）。詳細度の差とみなせる */
  | "prefix"
  /** 途中から食い違う（例: 3-12-5 と 3-13-1） */
  | "divergent"
  /** どちらかに街区符号が無い */
  | "unknown";

export type AddressSimilarity = {
  score: number;
  /** normalized_address が完全一致したか（最優先ルール） */
  exactMatch: boolean;
  /** 町名部分が同一とみなせるか */
  localityMatch: boolean;
  localitySimilarity: number;
  blockRelation: BlockRelation;
  /** 先頭から一致した街区符号の個数 */
  commonBlockDepth: number;
  left: NormalizedAddress;
  right: NormalizedAddress;
};

/**
 * 町名部分が同一かを判定する。
 * 片方に市区町村が欠けているケース（「東日暮里」と「荒川区東日暮里」）は
 * 同一として扱うが、「東日暮里」と「西日暮里」は別物として扱う。
 */
function isSameLocality(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 3 && longer.endsWith(shorter);
}

function compareBlocks(a: number[], b: number[]): { relation: BlockRelation; depth: number } {
  if (a.length === 0 || b.length === 0) return { relation: "unknown", depth: 0 };

  let depth = 0;
  const min = Math.min(a.length, b.length);
  while (depth < min && a[depth] === b[depth]) depth++;

  if (depth === a.length && depth === b.length) return { relation: "equal", depth };
  if (depth === min) return { relation: "prefix", depth };
  return { relation: "divergent", depth };
}

export function calculateAddressSimilarity(
  addressA: string | null | undefined,
  addressB: string | null | undefined,
): AddressSimilarity {
  const left = normalizeAddressDetailed(addressA);
  const right = normalizeAddressDetailed(addressB);

  const exactMatch =
    left.normalized.length > 0 && left.normalized === right.normalized;

  const localitySimilarity = levenshteinRatio(left.locality, right.locality);
  const localityMatch = isSameLocality(left.locality, right.locality);
  const { relation, depth } = compareBlocks(left.blocks, right.blocks);

  let score: number;
  if (exactMatch) {
    score = 1;
  } else if (!localityMatch) {
    // 町名が違う時点で別物件とみなす。文字列の似方は参考値に留める。
    score = localitySimilarity * 0.5;
  } else {
    const maxDepth = Math.max(left.blocks.length, right.blocks.length, 1);
    switch (relation) {
      case "equal":
        // 町名の書き方だけが違う（市区町村の有無など）
        score = 0.97;
        break;
      case "prefix":
        // 3-12 と 3-12-5。過去データの粒度が粗いだけの可能性が高い
        score = 0.85 + 0.1 * (depth / maxDepth);
        break;
      case "divergent":
        score = 0.45 + 0.25 * (depth / maxDepth);
        break;
      default:
        // 片方に番地が無い。町名は同じなので中程度
        score = 0.6;
        break;
    }
  }

  return {
    score: round4(Math.min(1, Math.max(0, score))),
    exactMatch,
    localityMatch,
    localitySimilarity: round4(localitySimilarity),
    blockRelation: relation,
    commonBlockDepth: depth,
    left,
    right,
  };
}
