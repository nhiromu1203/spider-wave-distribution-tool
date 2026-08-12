/**
 * CSV / Excel ファイルの読み込みとカラム推定。
 * ブラウザ側で完結させ、DB へ書く前に必ずプレビューを挟む。
 */

import Papa from "papaparse";

export type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Array<Record<string, string>>;
};

/** 取込先のフィールド */
export type TargetField =
  | "building_name"
  | "address"
  | "total_units"
  | "property_type"
  | "distributed_date"
  | "distributed_by"
  | "notes"
  | "latitude"
  | "longitude";

export type ColumnMapping = Partial<Record<TargetField, string | null>>;

export const FIELD_LABELS: Record<TargetField, string> = {
  building_name: "建物名",
  address: "住所",
  total_units: "総世帯数",
  property_type: "種別（賃貸 / 分譲）",
  distributed_date: "配布日",
  distributed_by: "担当者",
  notes: "備考",
  latitude: "緯度",
  longitude: "経度",
};

/** 列名の推定に使うキーワード。前方から順に優先して一致させる。 */
const FIELD_HINTS: Record<TargetField, string[]> = {
  building_name: ["建物名", "物件名", "マンション名", "建物", "名称", "物件", "name", "building"],
  address: ["住所", "所在地", "所在", "address", "location"],
  total_units: ["総世帯数", "世帯数", "戸数", "総戸数", "部屋数", "units", "households"],
  property_type: ["種別", "物件種別", "賃貸分譲", "type"],
  distributed_date: ["配布日", "実施日", "配布年月日", "日付", "date"],
  distributed_by: ["担当者", "担当", "配布者", "スタッフ", "staff", "by"],
  notes: ["備考", "メモ", "コメント", "note", "memo", "remarks"],
  latitude: ["緯度", "lat", "latitude"],
  longitude: ["経度", "lng", "lon", "longitude"],
};

const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm"];

export function isExcelFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * CSV を読み込む。
 * 文字コードは UTF-8 を既定とし、失敗した場合は Shift_JIS で読み直す
 * （Excel から書き出した CSV は Shift_JIS のことが多い）。
 */
export async function parseCsvFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();

  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  // U+FFFD が多数含まれる = UTF-8 として壊れている → Shift_JIS とみなす
  const replacementCount = (text.match(/�/g) ?? []).length;
  if (replacementCount > 0) {
    try {
      text = new TextDecoder("shift_jis").decode(buffer);
    } catch {
      // Shift_JIS デコーダが使えない環境ではそのまま
    }
  }
  text = text.replace(/^﻿/, "");

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  const rows = (result.data ?? []).map((row) => {
    const cleaned: Record<string, string> = {};
    for (const h of headers) cleaned[h] = String(row[h] ?? "").trim();
    return cleaned;
  });

  return { fileName: file.name, headers, rows };
}

/** ヘッダー名から取込先フィールドを推定する */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();

  for (const [field, hints] of Object.entries(FIELD_HINTS) as Array<
    [TargetField, string[]]
  >) {
    for (const hint of hints) {
      const found = headers.find(
        (h) => !used.has(h) && h.toLowerCase().includes(hint.toLowerCase()),
      );
      if (found) {
        mapping[field] = found;
        used.add(found);
        break;
      }
    }
  }

  return mapping;
}

/** 「12戸」「12世帯」など単位付きの数値も拾う。読めなければ null（＝不明）。 */
export function parseUnits(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.normalize("NFKC").match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 和暦・スラッシュ区切りなどを ISO 形式(YYYY-MM-DD)へ寄せる。読めなければ null。 */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.normalize("NFKC").trim();

  const ymd = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function parsePropertyType(
  value: string | undefined,
): "rental" | "condominium" | "unknown" {
  if (!value) return "unknown";
  const s = value.normalize("NFKC").toLowerCase();
  if (s.includes("賃貸") || s.includes("rental") || s.includes("賃")) return "rental";
  if (s.includes("分譲") || s.includes("condo") || s.includes("持家")) {
    return "condominium";
  }
  return "unknown";
}

export function parseCoordinate(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.normalize("NFKC").trim());
  return Number.isFinite(n) ? n : null;
}
