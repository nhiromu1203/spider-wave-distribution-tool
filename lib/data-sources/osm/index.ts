/**
 * ── OsmBuildingDataSource ──────────────────────────────────
 *
 * OpenStreetMap（Overpass API）から集合住宅を取得する取得元。
 * データは ODbL ライセンスで提供されており、Overpass API は
 * プログラムからの問い合わせを前提に公開されている。
 *
 * BUILDING_DATA_SOURCE=osm で選択する。
 * mock / csv / external_api / scraping と同じ BuildingDataSource であり、
 * 判定・重複照合・DB 保存・画面はすべて共通の経路を通る。
 * ────────────────────────────────────────────────────────────
 */

import { getPrefectureCode, listCities } from "../areas";
import {
  completeAddresses,
  getCityBlockPoints,
  ISJ_ATTRIBUTION,
} from "../address-completion";
import {
  boundsOf,
  gridSizeForPointCount,
  splitIntoTiles,
  type BBox,
} from "./tiles";
import type {
  AreaQuery,
  BuildingDataSource,
  DataSourceAvailability,
  FetchResult,
  SourceBuilding,
  SupportedArea,
} from "../types";
import { cacheKey, fetchOverpass, OverpassError, queryTimeoutSeconds } from "./client";
import { convertElements, type ConversionStats } from "./convert";
import { buildBuildingsQuery } from "./query";

export const OSM_SOURCE_ID = "osm";

/** 対応エリア。行政区域マスタの東京都（23区）をそのまま使う */
const SUPPORTED_PREFECTURES = ["東京都"];

/** 直近の取得内訳（画面表示用） */
export type OsmFetchSummary = ConversionStats & {
  fromCache: boolean;
  townFiltered: number | null;
};

/**
 * 区を何個の区画に分けるかを決め、各区画の範囲を返す。
 *
 * 分け方は街区点（位置参照情報）の分布から決まるため、
 * 同じ区なら毎回まったく同じ結果になる。リクエストをまたいでも
 * 「何番目の区画か」だけで続きから処理できる。
 *
 * 位置参照情報が使えない場合は分割せず、1 回で区全体を取得する
 * （従来どおりの動作。件数の少ない区では問題にならない）。
 */
export async function planAreaTiles(area: {
  prefecture: string;
  city: string;
}): Promise<BBox[] | null> {
  const prefectureCode = getPrefectureCode(area.prefecture);
  if (!prefectureCode) return null;

  try {
    const points = await getCityBlockPoints(prefectureCode, area.city);
    const bounds = boundsOf(points);
    if (!bounds) return null;

    return splitIntoTiles(bounds, gridSizeForPointCount(points.length));
  } catch {
    // 位置参照情報を用意できない場合は分割しない
    return null;
  }
}

let lastSummary: OsmFetchSummary | null = null;

export function getLastOsmFetchSummary(): OsmFetchSummary | null {
  return lastSummary;
}

export const osmBuildingDataSource: BuildingDataSource = {
  id: OSM_SOURCE_ID,
  label: "OpenStreetMap（Overpass API）",
  description:
    "OpenStreetMap から選択した区の集合住宅（building=apartments / housing）を取得します。データは ODbL ライセンスで提供されています。",
  isDevelopment: false,
  // OSM に building:flats があれば取得できるが、付いている建物は少ない
  supportsUnitCount: true,
  supportsCoordinates: true,

  isAvailable(): DataSourceAvailability {
    return { available: true };
  },

  listAreas(): SupportedArea[] {
    return SUPPORTED_PREFECTURES.flatMap((prefecture) =>
      listCities(prefecture).map((city) => ({ prefecture, city, towns: [] })),
    );
  },

  supportsArea(area: { prefecture: string; city: string }): boolean {
    return (
      SUPPORTED_PREFECTURES.includes(area.prefecture) &&
      listCities(area.prefecture).includes(area.city)
    );
  },

  async fetchByArea(area: AreaQuery): Promise<FetchResult> {
    if (!osmBuildingDataSource.supportsArea?.(area)) {
      throw new Error(
        `OpenStreetMap 取得元は ${area.prefecture} ${area.city} に対応していません（現在は東京都23区のみ）。`,
      );
    }

    // ── 取得範囲を区画に分ける ──────────────────────────────
    // 1 リクエストの実行時間には上限があるため、区全体を一度に
    // 取得しない。今回処理する区画だけを Overpass へ問い合わせる。
    const tiles = await planAreaTiles(area);
    const total = tiles?.length ?? 1;
    const index = Math.min(Math.max(area.chunkIndex ?? 0, 0), total - 1);
    const tile = tiles?.[index] ?? null;

    const query = buildBuildingsQuery(
      { prefecture: area.prefecture, city: area.city },
      queryTimeoutSeconds(),
      tile,
    );

    let fetched;
    try {
      // 町丁目の絞り込みは取得後に行い、追加リクエストを発生させない。
      fetched = await fetchOverpass(
        query,
        `${cacheKey(area.prefecture, area.city)}#${index}/${total}`,
      );
    } catch (error) {
      if (error instanceof OverpassError) throw new Error(error.message);
      throw error;
    }

    const { buildings, stats, rejectedSamples } = convertElements(fetched.elements, {
      prefecture: area.prefecture,
      city: area.city,
    });

    // ── 住所補完 ────────────────────────────────────────────
    // OSM の建物ポリゴンには住所タグがほとんど付いていないため、
    // 座標から住所を補う。補完処理は BuildingDataSource から独立しており、
    // 補完元は lib/data-sources/address-completion で差し替えられる。
    const pending = buildings.filter((b) => !b.address && b.latitude !== null);
    let completion: Awaited<ReturnType<typeof completeAddresses>> | null = null;

    if (pending.length > 0) {
      completion = await completeAddresses(
        pending.map((b) => ({
          latitude: b.latitude as number,
          longitude: b.longitude as number,
        })),
        { prefecture: area.prefecture, city: area.city },
      );

      pending.forEach((building, index) => {
        const completed = completion!.results[index];
        if (!completed) return;
        building.address = completed.address;
        building.prefecture = completed.prefecture ?? building.prefecture;
        building.city = completed.city ?? building.city;
        building.town = completed.town ?? building.town;
        building.address_source = completed.source;
        building.address_precision = completed.precision;
      });
    }

    // 住所が最後まで確定しなかった建物は登録しない（配布先を特定できないため）
    const withAddress = buildings.filter((b) => b.address.length > 0);
    const unresolved = buildings.length - withAddress.length;
    stats.rejected.no_address += unresolved;
    stats.accepted = withAddress.length;
    stats.withAddress = withAddress.length;

    // 町丁目が指定されていれば、取得済みデータから絞り込む
    let result: SourceBuilding[] = withAddress;
    let townFiltered: number | null = null;
    if (area.town) {
      result = withAddress.filter((b) => b.address.includes(area.town!));
      townFiltered = result.length;
    }

    lastSummary = { ...stats, fromCache: fetched.fromCache, townFiltered };

    const notes: string[] = [
      total > 1
        ? `OSM から ${stats.total} 件取得（${area.prefecture}${area.city} の区画 ${index + 1}/${total}）`
        : `OSM から ${stats.total} 件取得（${area.prefecture}${area.city}）`,
      `集合住宅として採用 ${stats.accepted} 件`,
      `用途対象外 ${
        stats.rejected.not_multi_dwelling +
        stats.rejected.mixed_use +
        stats.rejected.dormitory +
        stats.rejected.name_excluded
      } 件`,
      `住所不足で除外 ${stats.rejected.no_address} 件`,
      `建物名あり ${stats.withName} 件 / 座標あり ${stats.withCoordinates} 件 / 総戸数あり ${stats.withTotalUnits} 件`,
    ];
    if (completion) {
      const rate = ((completion.completed / pending.length) * 100).toFixed(1);
      notes.push(
        `住所補完 ${completion.completed} / ${pending.length} 件（${rate}%）— ${completion.provider?.label ?? "補完なし"}`,
      );
      const fromSource = withAddress.filter((b) => b.address_source === "source").length;
      notes.push(
        `住所の出所: OSM 由来 ${fromSource} 件 / 補完 ${withAddress.length - fromSource} 件`,
      );
      if (completion.note) notes.push(completion.note);
      if (completion.completed > 0) notes.push(`出典: ${ISJ_ATTRIBUTION}`);
    }
    if (fetched.fromCache && fetched.cachedAt) {
      notes.push(
        `Overpass API へは問い合わせず、${fetched.cachedAt.toLocaleString("ja-JP")} に取得した内容を使用しました。`,
      );
    }
    if (townFiltered !== null) {
      notes.push(`町丁目「${area.town}」で ${townFiltered} 件に絞り込みました。`);
    }
    if (rejectedSamples.length > 0) {
      notes.push(
        `除外例: ${rejectedSamples
          .slice(0, 3)
          .map((r) => `${r.name ?? "（名称なし）"}（${r.detail}）`)
          .join(" / ")}`,
      );
    }
    notes.push("データ出典: © OpenStreetMap contributors（ODbL）");

    return {
      buildings: result,
      totalAvailable: result.length,
      notes,
      chunk: { index, total },
    };
  },
};

export { clearOverpassCache, OverpassError } from "./client";
export { convertElement, convertElements, buildAddress } from "./convert";
export { buildBuildingsQuery, buildCountQuery, TARGET_BUILDING_TAGS } from "./query";
export type { OsmElement, ConversionStats } from "./convert";
