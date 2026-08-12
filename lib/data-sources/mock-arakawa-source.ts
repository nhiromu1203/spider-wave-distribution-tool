/**
 * ── MockBuildingDataSource（開発確認用）────────────────────
 *
 * 本番の建物データソースが未確定のため、UI と重複判定の動作確認用に
 * 少量のダミーデータを返す取得元。荒川区のみに対応する。
 *
 * ・source_ref は必ず "mock-" で始まり、画面上で「開発用データ」と表示される
 * ・本番環境では自動選択されない（registry 側で明示的に禁止している）
 * ・total_units は意図的にすべて null（＝「不明」）にしてある。
 *   総世帯数の自動取得は未実装であり、推測値を入れてはならないため。
 * ・緯度経度も提供しない（null のままで全機能が正常動作することの確認を兼ねる）
 * ────────────────────────────────────────────────────────────
 */

import type { PropertyType } from "@/lib/supabase/types";
import type {
  AreaQuery,
  BuildingDataSource,
  DataSourceAvailability,
  FetchResult,
  SourceBuilding,
  SupportedArea,
} from "./types";

type MockBuilding = {
  ref: string;
  name: string;
  address: string;
  town: string;
  propertyType: PropertyType;
};

/**
 * 荒川区の建物（開発確認用）。
 *
 * 先頭 4 件は samples/過去配布済みリスト_サンプル.csv と対応しており、
 * 過去配布リストを取り込むと重複判定の 3 パターンがすべて再現できる。
 */
const ARAKAWA_BUILDINGS: MockBuilding[] = [
  // ルール1: 住所完全一致 → CONFIRMED_DISTRIBUTED（配布対象から自動除外）
  {
    ref: "001",
    name: "GRAND MAISON NIPPORI",
    address: "東京都荒川区東日暮里1-5-3",
    town: "東日暮里",
    propertyType: "rental",
  },
  // ルール1: 丁目/番/号 表記でも住所一致 → CONFIRMED_DISTRIBUTED
  {
    ref: "002",
    name: "ロイヤルパレス三ノ輪",
    address: "東京都荒川区東日暮里6丁目60番1号",
    town: "東日暮里",
    propertyType: "condominium",
  },
  // ルール2: 住所前方一致 + 建物名高類似 → POSSIBLE_DUPLICATE（要確認）
  {
    ref: "003",
    name: "GRAND COURT NIPPORI",
    address: "東京都荒川区東日暮里3-12-5",
    town: "東日暮里",
    propertyType: "rental",
  },
  // ルール3: 建物名は同一だが住所（町名）が違う → NOT_DISTRIBUTED（配布対象）
  {
    ref: "004",
    name: "SUNRISE",
    address: "東京都荒川区西日暮里5-5-5",
    town: "西日暮里",
    propertyType: "condominium",
  },

  // 以下は過去配布リストと無関係な建物（配布対象として残る）
  {
    ref: "005",
    name: "メゾンひぐらし",
    address: "東京都荒川区東日暮里2-20-4",
    town: "東日暮里",
    propertyType: "rental",
  },
  {
    ref: "006",
    name: "コーポ町屋",
    address: "東京都荒川区町屋1-3-7",
    town: "町屋",
    propertyType: "rental",
  },
  {
    ref: "007",
    name: "町屋グリーンハイツ",
    address: "東京都荒川区町屋4-12-2",
    town: "町屋",
    propertyType: "rental",
  },
  {
    ref: "008",
    name: "サンハイム南千住",
    address: "東京都荒川区南千住3-8-15",
    town: "南千住",
    propertyType: "condominium",
  },
  {
    ref: "009",
    name: "リバーサイド南千住",
    address: "東京都荒川区南千住8-4-1",
    town: "南千住",
    propertyType: "condominium",
  },
  {
    ref: "010",
    name: "パークホームズ荒川",
    address: "東京都荒川区荒川2-15-6",
    town: "荒川",
    propertyType: "condominium",
  },
  {
    ref: "011",
    name: "荒川第三マンション",
    address: "東京都荒川区荒川5-1-9",
    town: "荒川",
    propertyType: "rental",
  },
  {
    ref: "012",
    name: "ヴィラ東尾久",
    address: "東京都荒川区東尾久3-22-8",
    town: "東尾久",
    propertyType: "rental",
  },
  {
    ref: "013",
    name: "セントラルレジデンス西尾久",
    address: "東京都荒川区西尾久6-30-2",
    town: "西尾久",
    propertyType: "condominium",
  },
  {
    ref: "014",
    name: "西尾久ハイツ",
    address: "東京都荒川区西尾久2-9-14",
    town: "西尾久",
    propertyType: "rental",
  },
  {
    ref: "015",
    name: "スカイコート日暮里",
    address: "東京都荒川区西日暮里2-40-7",
    town: "西日暮里",
    propertyType: "rental",
  },
  {
    ref: "016",
    name: "ハイツ町屋銀座",
    address: "東京都荒川区町屋2-19-3",
    town: "町屋",
    // 種別が取得できなかったケース（画面上は「不明」と表示される）
    propertyType: "unknown",
  },
];

const AREAS: SupportedArea[] = [
  {
    prefecture: "東京都",
    city: "荒川区",
    towns: [...new Set(ARAKAWA_BUILDINGS.map((b) => b.town))].sort((a, b) =>
      a.localeCompare(b, "ja"),
    ),
  },
];

function toSourceBuilding(b: MockBuilding, sourceId: string): SourceBuilding {
  return {
    source_ref: `${sourceId}:${b.ref}`,
    building_name: b.name,
    address: b.address,
    prefecture: "東京都",
    city: "荒川区",
    town: b.town,
    property_type: b.propertyType,
    // モックはすべて集合住宅（OSM の building=apartments 相当）
    building_use_raw: "apartments",
    // 総世帯数の自動取得は未実装。推測せず null（=「不明」）のままにする。
    total_units: null,
    latitude: null,
    longitude: null,
  };
}

/** BUILDING_DATA_SOURCE=mock で選択される取得元 */
export const MOCK_BUILDING_SOURCE_ID = "mock";

export const mockBuildingDataSource: BuildingDataSource = {
  id: MOCK_BUILDING_SOURCE_ID,
  label: "開発用モックデータ（荒川区）",
  description:
    "本番の建物データソースが未確定のため用意した、UI 確認用のダミーデータです。実在の物件情報ではありません。",
  isDevelopment: true,
  supportsUnitCount: false,
  supportsCoordinates: false,

  isAvailable(): DataSourceAvailability {
    // 本番環境では明示指定されても使わせない。
    // 一度でも取り込むと実データと混ざり、あとから見分けるのが難しくなるため。
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_MOCK_DATA_IN_PRODUCTION !== "1"
    ) {
      return {
        available: false,
        reason:
          "本番環境では開発用モックデータを使用できません。実データの取得元を BUILDING_DATA_SOURCE に設定してください。",
      };
    }
    return { available: true };
  },

  listAreas(): SupportedArea[] {
    return AREAS;
  },

  async fetchByArea(area: AreaQuery): Promise<FetchResult> {
    const matches = ARAKAWA_BUILDINGS.filter((b) => {
      if (area.prefecture !== "東京都" || area.city !== "荒川区") return false;
      // 町名未指定なら市区町村全体が対象
      if (area.town && b.town !== area.town) return false;
      return true;
    });

    return {
      buildings: matches.map((b) =>
        toSourceBuilding(b, mockBuildingDataSource.id),
      ),
      totalAvailable: matches.length,
      notes: [
        "開発確認用のダミーデータです。実在の物件情報ではありません。",
        "総世帯数は取得できないため、すべて「不明」として登録されます。",
      ],
    };
  },
};
