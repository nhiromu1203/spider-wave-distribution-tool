/**
 * 重複判定モジュールの公開 API。
 * React コンポーネントからは必ずこの入口経由で使うこと
 * （判定ロジックを UI に書かない）。
 */

export {
  normalizeAddress,
  normalizeAddressDetailed,
  parseAddressParts,
  type NormalizedAddress,
  type AddressParts,
} from "./normalizeAddress";

export {
  normalizeBuildingName,
  normalizeBuildingNameDetailed,
  type NormalizedBuildingName,
} from "./normalizeBuildingName";

export {
  calculateAddressSimilarity,
  type AddressSimilarity,
  type BlockRelation,
} from "./calculateAddressSimilarity";

export {
  calculateNameSimilarity,
  type NameSimilarity,
} from "./calculateNameSimilarity";

export { distanceInMeters, type Coordinates } from "./geo";

export {
  matchBuilding,
  DEFAULT_THRESHOLDS,
  type MatchStatus,
  type MatchResult,
  type MatchCandidate,
  type MatchableBuilding,
  type MatchThresholds,
} from "./matchBuilding";

export { LEXICON, type LexiconEntry } from "./dictionaries";
