/**
 * 重複判定エンジン。
 *
 * ── 判定方針 ───────────────────────────────────────────────
 * 「未配布なのに重複候補として一旦除外してしまう」ことより、
 * 「配布済みなのに未配布と誤判定して二重配布してしまう」ことの方が
 * 損失が大きい。したがって迷った場合は必ず安全側（POSSIBLE_DUPLICATE）に倒す。
 *
 * ── ルール ─────────────────────────────────────────────────
 * ルール1: normalized_address 完全一致
 *          → CONFIRMED_DISTRIBUTED（建物名が違っていても住所を優先）
 * ルール2: 住所が高類似 かつ 建物名も高類似        → POSSIBLE_DUPLICATE
 * ルール3: 住所が部分一致 かつ 翻字を考慮した建物名が高類似
 *                                                  → POSSIBLE_DUPLICATE
 * ルール4: 建物名だけが類似し、住所が明確に違う    → NOT_DISTRIBUTED
 *          （同名の建物が別住所に存在しうるため）
 */

import { calculateAddressSimilarity, type AddressSimilarity } from "./calculateAddressSimilarity";
import { calculateNameSimilarity, type NameSimilarity } from "./calculateNameSimilarity";
import { distanceInMeters } from "./geo";
import { round4 } from "./similarity";

export type MatchStatus =
  | "CONFIRMED_DISTRIBUTED"
  | "POSSIBLE_DUPLICATE"
  | "NOT_DISTRIBUTED";

/** 判定の入力となる最小限の物件情報 */
export type MatchableBuilding = {
  id?: string;
  building_name: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type MatchThresholds = {
  /** 街区符号が前方一致のときに重複候補とみなす建物名類似度 */
  namePrefixThreshold: number;
  /** 街区符号が食い違うときに重複候補とみなす建物名類似度 */
  nameDivergentThreshold: number;
  /** 町名だけ一致（番地不明）のときに重複候補とみなす建物名類似度 */
  nameUnknownBlockThreshold: number;
  /** 座標がこの距離以内なら建物名を問わず重複候補にする（m） */
  geoSameBuildingMeters: number;
  /** 座標がこの距離以内かつ建物名が近ければ重複候補にする（m） */
  geoNearbyMeters: number;
  /** 上記の「建物名が近い」の閾値 */
  geoNearbyNameThreshold: number;
};

export const DEFAULT_THRESHOLDS: MatchThresholds = {
  namePrefixThreshold: 0.45,
  nameDivergentThreshold: 0.85,
  nameUnknownBlockThreshold: 0.6,
  geoSameBuildingMeters: 10,
  geoNearbyMeters: 30,
  geoNearbyNameThreshold: 0.5,
};

export type MatchCandidate<T extends MatchableBuilding = MatchableBuilding> = {
  building: T;
  addressSimilarity: number;
  nameSimilarity: number;
  distanceMeters: number | null;
  /** 画面に表示する判定理由 */
  reasons: string[];
  address: AddressSimilarity;
  name: NameSimilarity;
};

export type MatchResult<T extends MatchableBuilding = MatchableBuilding> = {
  status: MatchStatus;
  /** ルール1で確定した相手（CONFIRMED_DISTRIBUTED のときのみ） */
  matched: T | null;
  /** 重複候補（スコア降順）。POSSIBLE_DUPLICATE のとき 1 件以上 */
  candidates: Array<MatchCandidate<T>>;
};

function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * 1 件の新規物件を、過去配布済み物件の集合と照合する。
 *
 * @param target    判定対象の新規取得物件
 * @param existing  過去に配布済みとして登録されている物件
 */
export function matchBuilding<T extends MatchableBuilding>(
  target: MatchableBuilding,
  existing: readonly T[],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchResult<T> {
  const candidates: Array<MatchCandidate<T>> = [];

  for (const other of existing) {
    if (target.id && other.id && target.id === other.id) continue;

    const address = calculateAddressSimilarity(target.address, other.address);
    const name = calculateNameSimilarity(target.building_name, other.building_name);
    const distance = distanceInMeters(
      { latitude: target.latitude, longitude: target.longitude },
      { latitude: other.latitude, longitude: other.longitude },
    );

    // ── ルール1: 住所完全一致は建物名を問わず配布済み確定 ──────────
    if (address.exactMatch) {
      const reasons = ["住所完全一致（normalized_address）"];
      if (!name.tokenExactMatch && name.score < 1) {
        reasons.push(`建物名は不一致だが住所一致を優先（建物名類似度 ${percent(name.score)}）`);
      }
      return {
        status: "CONFIRMED_DISTRIBUTED",
        matched: other,
        candidates: [
          {
            building: other,
            addressSimilarity: 1,
            nameSimilarity: name.score,
            distanceMeters: distance,
            reasons,
            address,
            name,
          },
        ],
      };
    }

    const reasons: string[] = [];
    let isCandidate = false;

    if (address.localityMatch) {
      switch (address.blockRelation) {
        case "equal":
          // 住所は同じだが表記が違う（市区町村の有無など）。ほぼ同一。
          isCandidate = true;
          reasons.push("町名・街区符号が一致（住所表記のみ相違）");
          break;

        case "prefix":
          // ルール3: 3-12 と 3-12-5 のような詳細度の差
          if (name.score >= thresholds.namePrefixThreshold) {
            isCandidate = true;
            reasons.push("住所部分一致（街区符号が前方一致）");
          }
          break;

        case "divergent":
          // ルール2: 番地が食い違う。建物名が非常に近い場合のみ候補にする
          if (name.score >= thresholds.nameDivergentThreshold) {
            isCandidate = true;
            reasons.push("同一町名・番地相違だが建物名が高類似");
          }
          break;

        default:
          // 片方に番地が無い
          if (name.score >= thresholds.nameUnknownBlockThreshold) {
            isCandidate = true;
            reasons.push("同一町名・番地情報が不足");
          }
          break;
      }
    }

    // ── 緯度経度による補助判定（座標が無ければ何もしない） ────────
    if (distance !== null) {
      if (distance <= thresholds.geoSameBuildingMeters) {
        isCandidate = true;
        reasons.push(`座標距離 ${Math.round(distance)}m（ほぼ同一地点）`);
      } else if (
        distance <= thresholds.geoNearbyMeters &&
        name.score >= thresholds.geoNearbyNameThreshold
      ) {
        isCandidate = true;
        reasons.push(`座標距離 ${Math.round(distance)}m かつ建物名が類似`);
      }
    }

    if (!isCandidate) continue;

    reasons.push(`住所類似度 ${percent(address.score)}`);
    reasons.push(`建物名類似度 ${percent(name.score)}`);
    if (name.transliterationMatch) {
      reasons.push("ローマ字 / カタカナ表記の違いを吸収して一致");
    }

    candidates.push({
      building: other,
      addressSimilarity: address.score,
      nameSimilarity: name.score,
      distanceMeters: distance === null ? null : round4(distance),
      reasons,
      address,
      name,
    });
  }

  if (candidates.length === 0) {
    // ルール4 に該当するケース（建物名だけ似ていて住所が違う）もここに落ちる
    return { status: "NOT_DISTRIBUTED", matched: null, candidates: [] };
  }

  candidates.sort(
    (a, b) =>
      b.addressSimilarity - a.addressSimilarity ||
      b.nameSimilarity - a.nameSimilarity,
  );

  return { status: "POSSIBLE_DUPLICATE", matched: null, candidates };
}
