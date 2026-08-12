/**
 * 建物データ取得元のレジストリと選択ロジック。
 *
 * ── 取得元の選び方 ──────────────────────────────────────────
 * 環境変数 BUILDING_DATA_SOURCE で明示的に選ぶ。
 *
 *   BUILDING_DATA_SOURCE=mock          開発用モックデータ（荒川区）
 *   BUILDING_DATA_SOURCE=osm           OpenStreetMap（Overpass API）
 *   BUILDING_DATA_SOURCE=csv           アップロードした建物一覧 CSV
 *   BUILDING_DATA_SOURCE=external_api  外部建物データ API
 *   BUILDING_DATA_SOURCE=scraping      HTML 一覧ページからの取得
 *                                      （自動取得が許可されたサイトのみ）
 *
 * 未指定の場合:
 *   ・開発環境 → mock
 *   ・本番環境 → external_api（モックへは絶対にフォールバックしない）
 *
 * 選んだ取得元が使えない場合は、代わりの取得元を勝手に使わず、
 * 「なぜ使えないか」を画面に表示する。黙って別のデータを混ぜないため。
 * ────────────────────────────────────────────────────────────
 */

import {
  externalApiBuildingDataSource,
  EXTERNAL_API_SOURCE_ID,
} from "./external-api-source";
import {
  mockBuildingDataSource,
  MOCK_BUILDING_SOURCE_ID,
} from "./mock-arakawa-source";
import { csvBuildingDataSource } from "./csv";
import { osmBuildingDataSource } from "./osm";
import { scrapingBuildingDataSource } from "./scraping";
import type { BuildingDataSource, SupportedArea } from "./types";

export const DATA_SOURCES: BuildingDataSource[] = [
  externalApiBuildingDataSource,
  osmBuildingDataSource,
  csvBuildingDataSource,
  scrapingBuildingDataSource,
  mockBuildingDataSource,
];

export function getDataSource(id: string): BuildingDataSource | null {
  return DATA_SOURCES.find((s) => s.id === id) ?? null;
}

export function listAvailableDataSources(): BuildingDataSource[] {
  return DATA_SOURCES.filter((s) => s.isAvailable().available);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export type BuildingSourceResolution = {
  /** BUILDING_DATA_SOURCE で選択された取得元（利用可否は問わない） */
  selected: BuildingDataSource | null;
  /** 実際に使用できる取得元。使えないときは null */
  active: BuildingDataSource | null;
  /** active が null のときの理由（そのまま画面に出せる日本語） */
  unavailableReason: string | null;
  /** 選択に使われた識別子 */
  selectedId: string;
  /** 環境変数で明示指定されたか、既定で決まったか */
  mode: "explicit" | "default";
};

/**
 * 使用する建物データ取得元を決定する。
 * 副作用なし・ネットワークアクセスなし。
 */
export function resolveBuildingDataSource(): BuildingSourceResolution {
  const configured = process.env.BUILDING_DATA_SOURCE?.trim();
  const mode: BuildingSourceResolution["mode"] = configured ? "explicit" : "default";

  // 未指定時の既定。本番でモックを既定にしてはならない。
  const selectedId =
    configured || (isProduction() ? EXTERNAL_API_SOURCE_ID : MOCK_BUILDING_SOURCE_ID);

  const selected = getDataSource(selectedId);

  if (!selected) {
    return {
      selected: null,
      active: null,
      selectedId,
      mode,
      unavailableReason:
        `BUILDING_DATA_SOURCE に不明な値「${selectedId}」が指定されています。` +
        `指定できるのは ${DATA_SOURCES.map((s) => s.id).join(" / ")} です。`,
    };
  }

  // 明示指定が無いまま本番でモックが選ばれることを防ぐ二重の歯止め
  if (selected.isDevelopment && isProduction() && mode === "default") {
    return {
      selected,
      active: null,
      selectedId,
      mode,
      unavailableReason:
        "本番環境では開発用モックデータへ自動的に切り替えません。BUILDING_DATA_SOURCE と接続先を設定してください。",
    };
  }

  const availability = selected.isAvailable();
  if (!availability.available) {
    return {
      selected,
      active: null,
      selectedId,
      mode,
      unavailableReason: availability.reason,
    };
  }

  return {
    selected,
    active: selected,
    selectedId,
    mode,
    unavailableReason: null,
  };
}

/** 現在使用できる建物データ取得元。使えない場合は null。 */
export function getActiveBuildingSource(): BuildingDataSource | null {
  return resolveBuildingDataSource().active;
}

/**
 * エリア選択プルダウンに出す対応エリア。
 * 実際に使用する取得元のものだけを出す（使えない取得元のエリアは出さない）。
 */
export function listSupportedAreas(): SupportedArea[] {
  const active = getActiveBuildingSource();
  if (!active) return [];

  const merged = new Map<string, SupportedArea>();
  for (const area of active.listAreas()) {
    const key = `${area.prefecture} ${area.city}`;
    const existing = merged.get(key);
    if (existing) {
      existing.towns = [...new Set([...existing.towns, ...area.towns])].sort((a, b) =>
        a.localeCompare(b, "ja"),
      );
    } else {
      merged.set(key, { ...area, towns: [...area.towns] });
    }
  }
  return [...merged.values()];
}

export {
  externalApiBuildingDataSource,
  EXTERNAL_API_SOURCE_ID,
} from "./external-api-source";
export {
  mockBuildingDataSource,
  MOCK_BUILDING_SOURCE_ID,
} from "./mock-arakawa-source";
export {
  scrapingBuildingDataSource,
  SCRAPING_SOURCE_ID,
  validateSiteConfig,
} from "./scraping";
export {
  csvBuildingDataSource,
  CSV_SOURCE_ID,
  refreshCsvAreas,
} from "./csv";
export {
  osmBuildingDataSource,
  OSM_SOURCE_ID,
  getLastOsmFetchSummary,
} from "./osm";
export {
  DEVELOPMENT_SOURCE_PREFIX,
  isDevelopmentData,
  sourceSupportsArea,
  toNullableCoordinate,
  toNullableCount,
  toPropertyType,
} from "./types";
export {
  AREA_MASTER,
  getCityCode,
  isKnownArea,
  listCities,
  listPrefectures,
  TOKYO_23_WARD_NAMES,
} from "./areas";
export type {
  AreaQuery,
  BuildingDataSource,
  DataSourceAvailability,
  FetchResult,
  SourceBuilding,
  SupportedArea,
} from "./types";
