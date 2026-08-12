/**
 * ── CsvBuildingDataSource ──────────────────────────────────
 *
 * アップロードした建物一覧 CSV を、mock / external_api と同じ
 * BuildingDataSource として扱う取得元。
 *
 * CSV は解析済みの SourceBuilding[] としてサーバー側に保管され、
 * fetchByArea() はそこからエリアで絞り込んで返す。
 * 画面・重複判定・DB 同期・認証の扱いは他の取得元と完全に同じ。
 *
 * 対応エリアはアップロードされたデータの中身から決まるため、
 * 東京都23区でも他の道府県でも、データさえ入れれば対応できる。
 * ────────────────────────────────────────────────────────────
 */

import type {
  AreaQuery,
  BuildingDataSource,
  DataSourceAvailability,
  FetchResult,
  SourceBuilding,
  SupportedArea,
} from "../types";
import { listDatasets, loadAllBuildings } from "./store";

export const CSV_SOURCE_ID = "csv";

/**
 * listAreas() は同期メソッドだが、データセットの読み込みは非同期のため
 * 直近に読み込んだ対応エリアをここに保持する。
 * 初回は空配列を返し、fetchByArea / refreshAreas 後に埋まる。
 */
let cachedAreas: SupportedArea[] = [];
let cachedDatasetCount = 0;

/** データセットを読み直して対応エリアを更新する */
export async function refreshCsvAreas(): Promise<SupportedArea[]> {
  const datasets = await listDatasets();
  cachedDatasetCount = datasets.length;

  const merged = new Map<string, SupportedArea>();
  for (const dataset of datasets) {
    for (const area of dataset.areas) {
      const key = `${area.prefecture}/${area.city}`;
      if (!merged.has(key)) {
        merged.set(key, { prefecture: area.prefecture, city: area.city, towns: [] });
      }
    }
  }

  cachedAreas = [...merged.values()].sort(
    (a, b) =>
      a.prefecture.localeCompare(b.prefecture, "ja") ||
      a.city.localeCompare(b.city, "ja"),
  );
  return cachedAreas;
}

/** 読み込み済みデータセットの件数（画面表示用） */
export function getCsvDatasetCount(): number {
  return cachedDatasetCount;
}

export const csvBuildingDataSource: BuildingDataSource = {
  id: CSV_SOURCE_ID,
  label: "CSV 取込データ",
  description:
    "アップロードした建物一覧 CSV から、選択したエリアの建物を取得します。UTF-8（BOM 有無）と Shift_JIS に対応します。",
  isDevelopment: false,
  // CSV に列があれば取得できる。無ければ null になる。
  supportsUnitCount: true,
  supportsCoordinates: true,

  isAvailable(): DataSourceAvailability {
    // ファイルの有無は非同期でしか確認できないため、ここでは常に利用可能とし、
    // データが無い場合は fetchByArea() が「データセット未登録」を返す。
    return { available: true };
  },

  listAreas(): SupportedArea[] {
    return cachedAreas;
  },

  async listTowns(area: { prefecture: string; city: string }): Promise<string[]> {
    const buildings = await loadAllBuildings();
    const towns = new Set<string>();

    for (const b of buildings) {
      if (b.prefecture !== area.prefecture || b.city !== area.city) continue;
      if (b.town) towns.add(b.town);
    }

    return [...towns].sort((a, b) => a.localeCompare(b, "ja"));
  },

  /**
   * 取り込んだデータに含まれているエリアなら対応とみなす。
   * 未読み込みの状態でも取得を試せるよう、キャッシュが空なら true を返す。
   */
  supportsArea(area: { prefecture: string; city: string }): boolean {
    if (cachedAreas.length === 0) return true;
    return cachedAreas.some(
      (a) => a.prefecture === area.prefecture && a.city === area.city,
    );
  },

  async fetchByArea(area: AreaQuery): Promise<FetchResult> {
    const datasets = await listDatasets();
    if (datasets.length === 0) {
      throw new Error(
        "建物一覧 CSV が登録されていません。「過去配布リスト取込」画面から建物一覧 CSV をアップロードしてください。",
      );
    }

    const all = await loadAllBuildings();
    await refreshCsvAreas();

    const matched: SourceBuilding[] = [];
    const seen = new Set<string>();

    for (const building of all) {
      if (building.prefecture && building.prefecture !== area.prefecture) continue;
      if (building.city !== area.city) continue;
      if (area.town && building.town !== area.town) continue;

      // 同じ建物が複数のデータセットに含まれていた場合に備える
      const key = `${building.address}|${building.building_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push(building);
    }

    const notes = [
      `${datasets.length} 件のデータセット（合計 ${all.length.toLocaleString("ja-JP")} 件）から抽出しました。`,
    ];
    if (matched.length === 0) {
      notes.push(
        `${area.prefecture} ${area.city}${area.town ? ` ${area.town}` : ""} に該当する行がありませんでした。CSV の住所欄をご確認ください。`,
      );
    }

    return { buildings: matched, totalAvailable: matched.length, notes };
  },
};

export {
  CSV_MAX_ROWS_DEFAULT,
  decodeCsv,
  mapHeaders,
  parseBuildingCsv,
  type CsvColumnMap,
  type CsvEncoding,
  type CsvParseResult,
} from "./parse";
export {
  getDatasetDirectory,
  listDatasets,
  loadAllBuildings,
  saveDataset,
  summarizeAreas,
  toDatasetId,
  type CsvDatasetMeta,
} from "./store";
