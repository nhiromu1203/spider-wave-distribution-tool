/**
 * 建物一覧 CSV の解析。
 *
 * ── 対応する文字コード ──────────────────────────────────────
 * ・UTF-8（BOM あり / なし）
 * ・Shift_JIS（Excel から書き出した CSV で最も多い）
 * 判定は「UTF-8 として厳密にデコードできるか」で行い、
 * 失敗した場合のみ Shift_JIS とみなす。推測の順序を固定して再現性を保つ。
 *
 * ── 標準ヘッダー ────────────────────────────────────────────
 * 建物名 / 住所 / 総戸数 / 種別 / 緯度 / 経度
 * 列が無い場合はその項目を null にする（推測はしない）。
 */

import Papa from "papaparse";
import { parseAddressParts } from "@/lib/building-matching";
import { findPrefectureByCity } from "../areas";
import {
  toNullableCoordinate,
  toNullableCount,
  toPropertyType,
  type SourceBuilding,
} from "../types";

export type CsvEncoding = "utf-8" | "utf-8-bom" | "shift_jis";

export type EncodingDetection = {
  encoding: CsvEncoding;
  text: string;
};

const BOM = "﻿";

/**
 * 文字コードを判定して文字列へ変換する。
 * どちらでも読めなかった場合は置換文字を含む UTF-8 として返し、
 * 呼び出し側が行単位で異常を検出できるようにする。
 */
export function decodeCsv(buffer: ArrayBuffer): EncodingDetection {
  const bytes = new Uint8Array(buffer);
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  // BOM 付きは UTF-8 で確定
  if (hasBom) {
    const text = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
    return { encoding: "utf-8-bom", text };
  }

  // BOM 無し。まず UTF-8 として厳密にデコードしてみる
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { encoding: "utf-8", text };
  } catch {
    // UTF-8 として不正 → Shift_JIS とみなす
  }

  try {
    const text = new TextDecoder("shift_jis").decode(buffer);
    return { encoding: "shift_jis", text: text.replace(/^﻿/, "") };
  } catch {
    // Shift_JIS デコーダが使えない環境向けの保険
    const text = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
    return { encoding: "utf-8", text };
  }
}

/** 標準ヘッダーと、実務でよく見かける別名 */
const HEADER_ALIASES: Record<keyof CsvColumnMap, string[]> = {
  building_name: ["建物名", "物件名", "マンション名", "建物", "名称", "物件", "name"],
  address: ["住所", "所在地", "所在", "address"],
  total_units: ["総戸数", "総世帯数", "戸数", "世帯数", "部屋数", "units"],
  property_type: ["種別", "物件種別", "賃貸分譲", "type"],
  latitude: ["緯度", "lat", "latitude"],
  longitude: ["経度", "lng", "lon", "longitude"],
  prefecture: ["都道府県", "県名", "prefecture"],
  city: ["市区町村", "市区郡", "区", "市", "city"],
  town: ["町名", "町丁目", "大字", "town"],
  building_use: ["用途", "建物用途", "building", "use", "構造"],
};

export type CsvColumnMap = {
  building_name: string | null;
  address: string | null;
  total_units: string | null;
  property_type: string | null;
  latitude: string | null;
  longitude: string | null;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  building_use: string | null;
};

const EMPTY_MAP: CsvColumnMap = {
  building_name: null,
  address: null,
  total_units: null,
  property_type: null,
  latitude: null,
  longitude: null,
  prefecture: null,
  city: null,
  town: null,
  building_use: null,
};

/** ヘッダー行から列を対応づける。見つからない列は null のまま */
export function mapHeaders(headers: string[]): CsvColumnMap {
  const map: CsvColumnMap = { ...EMPTY_MAP };
  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof CsvColumnMap, string[]]
  >) {
    // 完全一致を優先し、無ければ部分一致
    const exact = headers.find(
      (h) => !used.has(h) && aliases.some((a) => h === a),
    );
    const partial =
      exact ??
      headers.find(
        (h) =>
          !used.has(h) &&
          aliases.some((a) => h.toLowerCase().includes(a.toLowerCase())),
      );

    if (partial) {
      map[field] = partial;
      used.add(partial);
    }
  }

  return map;
}

export type CsvParseResult = {
  buildings: SourceBuilding[];
  encoding: CsvEncoding;
  headers: string[];
  columnMap: CsvColumnMap;
  totalRows: number;
  /** 住所が無いなどで取り込めなかった行数 */
  skippedRows: number;
  /** 先頭数件の異常行（画面表示用） */
  skippedSamples: Array<{ row: number; reason: string }>;
};

export type CsvParseOptions = {
  /** source_ref の接頭辞に使う識別子 */
  sourceId: string;
  /** データセット名（source_ref に含める） */
  datasetName: string;
  /** 上限行数。超えた分は読み捨てる */
  maxRows?: number;
};

export const CSV_MAX_ROWS_DEFAULT = 100_000;

/**
 * CSV 本文を SourceBuilding[] へ変換する。
 * 住所が取れない行は捨てる（住所は配布済み判定の最優先キーのため）。
 */
export function parseBuildingCsv(
  buffer: ArrayBuffer,
  options: CsvParseOptions,
): CsvParseResult {
  const { encoding, text } = decodeCsv(buffer);
  const maxRows = options.maxRows ?? CSV_MAX_ROWS_DEFAULT;

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0);
  const columnMap = mapHeaders(headers);

  const buildings: SourceBuilding[] = [];
  const skippedSamples: Array<{ row: number; reason: string }> = [];
  let skippedRows = 0;
  let totalRows = 0;

  const pick = (row: Record<string, string>, column: string | null) => {
    if (!column) return null;
    const value = row[column];
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  };

  for (const row of parsed.data) {
    if (totalRows >= maxRows) break;
    totalRows++;

    const address = pick(row, columnMap.address);
    if (!address) {
      skippedRows++;
      if (skippedSamples.length < 20) {
        skippedSamples.push({
          row: totalRows + 1, // ヘッダー行を 1 行目として数える
          reason: columnMap.address
            ? "住所が空です"
            : "住所の列が見つかりません",
        });
      }
      continue;
    }

    // 都道府県・市区町村・町名は列があればそれを、無ければ住所から構文解析する
    const parts = parseAddressParts(address);
    const city = pick(row, columnMap.city) ?? parts.city;

    buildings.push({
      source_ref: `${options.sourceId}:${options.datasetName}#${totalRows}`,
      building_name: pick(row, columnMap.building_name) ?? "（建物名なし）",
      address,
      // 「荒川区東日暮里3-12」のように都道府県が省略されていても、
      // 市区町村名から一意に定まる場合は補う（定まらなければ null のまま）
      prefecture:
        pick(row, columnMap.prefecture) ??
        parts.prefecture ??
        findPrefectureByCity(city),
      city,
      town: pick(row, columnMap.town) ?? parts.town,
      property_type: toPropertyType(pick(row, columnMap.property_type)),
      // 用途列が無ければ種別列を代用し、それも無ければ建物名から判定される
      building_use_raw:
        pick(row, columnMap.building_use) ?? pick(row, columnMap.property_type),
      // 列が無い / 読めない場合は推測せず null（0 戸と混同しない）
      total_units: toNullableCount(pick(row, columnMap.total_units)),
      latitude: toNullableCoordinate(pick(row, columnMap.latitude), "latitude"),
      longitude: toNullableCoordinate(pick(row, columnMap.longitude), "longitude"),
    });
  }

  return {
    buildings,
    encoding,
    headers,
    columnMap,
    totalRows,
    skippedRows,
    skippedSamples,
  };
}
