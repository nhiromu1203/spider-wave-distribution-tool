/**
 * 建物用途の判定。
 *
 * ── 配布対象 ────────────────────────────────────────────────
 * 集合住宅（マンション・アパート）のみ。
 * OSM では building=apartments / building=housing に相当する。
 *
 * ── 対象外 ──────────────────────────────────────────────────
 * 戸建て・一軒家・長屋・テラスハウス・寮・社宅・店舗・店舗付き住宅・
 * オフィス・事務所・工場・倉庫・学校・病院・ガレージ・駐車場、
 * その他住居以外の建物。
 * さらに「用途を判定できない建物」も配布対象にしない。
 *
 * ── 判定できない建物を除外することの影響 ────────────────────
 * 除外された建物は一覧に現れず、除外されたこと自体は取込結果の
 * 件数表示でしか分からない。取込のたびに「用途不明で除外した件数」を
 * 必ず表示すること。
 * ────────────────────────────────────────────────────────────
 */

import {
  CATEGORY_LABEL,
  classifyOsmBuildingTag,
  type OsmUseCategory,
} from "./osm-tags";

export type BuildingUse =
  /** 配布対象。集合住宅（マンション・アパート） */
  | "RESIDENTIAL_MULTI"
  /** 対象外。上記以外のすべて（用途を判定できない建物を含む） */
  | "EXCLUDED";

export type BuildingUseJudgement = {
  use: BuildingUse;
  /** 判定に使った語（画面表示用） */
  matchedTerm: string | null;
  /** OSM 語彙での分類。日本語表記から判定した場合も対応するカテゴリを入れる */
  category: OsmUseCategory | null;
  /** 判定理由（そのまま画面に出せる日本語） */
  reason: string;
  /** 用途が特定できなかったために除外したか（件数表示で区別するため） */
  excludedAsUnknown: boolean;
};

/**
 * 日本語表記から集合住宅と判断できる語。
 * 「店舗付きマンション」は店舗併設であり住居専用ではないため、
 * ここには含めず対象外とする。
 */
const JA_RESIDENTIAL_MULTI: readonly string[] = [
  "マンション",
  "アパート",
  "集合住宅",
  "共同住宅",
  "コーポ",
  "ハイツ",
  "メゾン",
  "レジデンス",
  "団地",
  "公営住宅",
  "都営住宅",
  "県営住宅",
  "市営住宅",
  "区営住宅",
];

/**
 * 日本語表記から対象外と判断できる語。
 * 集合住宅の語より先に照合する（「店舗付きマンション」を対象外にするため）。
 */
const JA_EXCLUDED: Array<{ term: string; category: OsmUseCategory }> = [
  { term: "店舗付き", category: "commercial" },
  { term: "店舗併用", category: "commercial" },
  { term: "戸建", category: "single_dwelling" },
  { term: "一戸建", category: "single_dwelling" },
  { term: "一軒家", category: "single_dwelling" },
  { term: "長屋", category: "single_dwelling" },
  { term: "テラスハウス", category: "single_dwelling" },
  { term: "タウンハウス", category: "single_dwelling" },
  { term: "寮", category: "other_residential" },
  { term: "社宅", category: "other_residential" },
  { term: "官舎", category: "other_residential" },
  { term: "老人ホーム", category: "other_residential" },
  { term: "店舗", category: "commercial" },
  { term: "商業施設", category: "commercial" },
  { term: "商業ビル", category: "commercial" },
  { term: "ショッピング", category: "commercial" },
  { term: "スーパー", category: "commercial" },
  { term: "ホテル", category: "commercial" },
  { term: "旅館", category: "commercial" },
  { term: "飲食", category: "commercial" },
  { term: "事務所", category: "office" },
  { term: "オフィス", category: "office" },
  { term: "工場", category: "industrial" },
  { term: "倉庫", category: "industrial" },
  { term: "作業所", category: "industrial" },
  { term: "学校", category: "institutional" },
  { term: "大学", category: "institutional" },
  { term: "高校", category: "institutional" },
  { term: "中学", category: "institutional" },
  { term: "小学", category: "institutional" },
  { term: "幼稚園", category: "institutional" },
  { term: "保育園", category: "institutional" },
  { term: "病院", category: "institutional" },
  { term: "診療所", category: "institutional" },
  { term: "クリニック", category: "institutional" },
  { term: "神社", category: "institutional" },
  { term: "寺院", category: "institutional" },
  { term: "教会", category: "institutional" },
  { term: "ガレージ", category: "ancillary" },
  { term: "駐車場", category: "ancillary" },
  { term: "車庫", category: "ancillary" },
  { term: "物置", category: "ancillary" },
];

function excludedAsUnknown(reason: string, matchedTerm: string | null): BuildingUseJudgement {
  return {
    use: "EXCLUDED",
    matchedTerm,
    category: "ambiguous",
    reason,
    excludedAsUnknown: true,
  };
}

/**
 * 建物用途を判定する。
 *
 * @param value 取得元が持つ用途の値。OSM の building タグ値、
 *              または「マンション」「店舗」などの日本語表記
 * @param buildingName 補助。用途の値が無い場合に建物名から判断を試みる
 */
export function classifyBuildingUse(
  value: string | null | undefined,
  buildingName?: string | null,
): BuildingUseJudgement {
  const raw = (value ?? "").normalize("NFKC").trim();

  /** 用途の値が曖昧だった場合、理由文言に残すためのタグ名 */
  let ambiguousTag: string | null = null;

  if (raw) {
    // ── 1. OSM の building タグとして照合する（最も確度が高い）──
    const category = classifyOsmBuildingTag(raw);
    if (category === "residential_multi") {
      return {
        use: "RESIDENTIAL_MULTI",
        matchedTerm: raw.toLowerCase(),
        category,
        reason: `OSM building=${raw.toLowerCase()}（集合住宅）`,
        excludedAsUnknown: false,
      };
    }
    if (category && category !== "ambiguous") {
      return {
        use: "EXCLUDED",
        matchedTerm: raw.toLowerCase(),
        category,
        reason: `OSM building=${raw.toLowerCase()}（${CATEGORY_LABEL[category]}）のため対象外`,
        excludedAsUnknown: false,
      };
    }
    if (category === "ambiguous") ambiguousTag = raw.toLowerCase();

    // ── 2. 日本語表記で照合する ────────────────────────────
    const judged = classifyJapanese(raw);
    if (judged) return judged;

    // ここで打ち切らず、建物名による判断へ進む。
    // building=residential / yes は用途を絞り込めないだけで、
    // 建物名（「○○レジデンス」など）が決め手になることがあるため。
  }

  // ── 3. 用途で決まらない場合、建物名から判断する ──────────
  // 標準の CSV には用途列が無いことが多いため、この経路が実質の主判定になる。
  const fromName = buildingName
    ? classifyJapanese(buildingName.normalize("NFKC"))
    : null;

  if (fromName) {
    const via = ambiguousTag ? `building=${ambiguousTag} だが、` : "";
    return {
      ...fromName,
      reason:
        fromName.use === "RESIDENTIAL_MULTI"
          ? `${via}建物名「${buildingName}」に「${fromName.matchedTerm}」が含まれるため集合住宅と判断`
          : `${via}建物名「${buildingName}」に「${fromName.matchedTerm}」が含まれるため対象外`,
    };
  }

  if (ambiguousTag) {
    return excludedAsUnknown(
      `OSM building=${ambiguousTag} は集合住宅と特定できず、建物名からも判断できないため対象外`,
      ambiguousTag,
    );
  }

  return excludedAsUnknown(
    raw
      ? `用途「${raw}」から集合住宅と判断できないため対象外`
      : "用途を判定できないため対象外",
    raw || null,
  );
}

/** 日本語表記から判定する。判定できなければ null */
function classifyJapanese(text: string): BuildingUseJudgement | null {
  // 「店舗付きマンション」を対象外にするため、除外語を先に照合する
  for (const { term, category } of JA_EXCLUDED) {
    if (text.includes(term)) {
      return {
        use: "EXCLUDED",
        matchedTerm: term,
        category,
        reason: `「${term}」を含むため${CATEGORY_LABEL[category]}として対象外`,
        excludedAsUnknown: false,
      };
    }
  }

  for (const term of JA_RESIDENTIAL_MULTI) {
    if (text.includes(term)) {
      return {
        use: "RESIDENTIAL_MULTI",
        matchedTerm: term,
        category: "residential_multi",
        reason: `「${term}」を含むため集合住宅と判断`,
        excludedAsUnknown: false,
      };
    }
  }

  return null;
}

export const BUILDING_USE_LABEL: Record<BuildingUse, string> = {
  RESIDENTIAL_MULTI: "集合住宅",
  EXCLUDED: "対象外",
};

export {
  CATEGORY_LABEL,
  classifyOsmBuildingTag,
  OSM_AMBIGUOUS,
  OSM_RESIDENTIAL_MULTI,
  type OsmUseCategory,
} from "./osm-tags";
