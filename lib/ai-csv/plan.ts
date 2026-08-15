/**
 * AI 調査 CSV の解析と、更新内容の判断。
 *
 * ここは DB を触らない純粋な処理にしてある。
 * 「何を変えるか」を決める部分と、実際に書き込む部分を分けておくと、
 * 取り違えを机上で検証できる。
 *
 * ── 判断の基本 ──────────────────────────────────────────────
 * 迷ったら更新しない。調査結果は人が確認する前提の情報であり、
 * 配布先の取り違えは実害に直結する。
 * ────────────────────────────────────────────────────────────
 */

import { parseCsv } from "@/lib/building-names/csv";
import { blockKeyOf, parseBlockKey } from "@/lib/building-names/block-key";

export const AI_CSV_COLUMNS = [
  "building_id",
  "building_name",
  // 現在 DB に入っている住所。調べる人が元の住所を見ながら
  // address 列を埋められるようにするための参考欄で、更新には使わない。
  "current_address",
  "address",
  "total_units",
  "property_type",
  "source",
  "note",
] as const;

/** CSV に必ず要る列。値は空でもよいが、列自体は必要 */
const REQUIRED_COLUMNS = ["building_name", "address"] as const;

export const UNKNOWN_NAME = "（建物名不明）";

/** アプリの property_type（DB の enum）と、CSV に書かれる日本語の対応 */
export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  rental: "賃貸",
  condominium: "分譲",
  unknown: "不明",
};

const PROPERTY_TYPE_FROM_CSV: Record<string, string> = {
  賃貸: "rental",
  分譲: "condominium",
  不明: "unknown",
  rental: "rental",
  condominium: "condominium",
  unknown: "unknown",
};

/**
 * source に書いてよい値。
 *
 * 自由入力にすると表記が散らばり、あとから「どの調査によるものか」を
 * 追えなくなる。使う手段は限られているので、その一覧に絞る。
 */
export const ALLOWED_SOURCES = [
  "chatgpt",
  "claude",
  "homes",
  "suumo",
  "google_maps",
  "manual",
] as const;

export type AllowedSource = (typeof ALLOWED_SOURCES)[number];

/** 大文字小文字と前後の空白だけ吸収する。それ以外は認めない */
export function parseSource(
  raw: string,
): { ok: true; value: AllowedSource } | { ok: false; reason: string } {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (v === "") {
    return {
      ok: false,
      reason: `source が未記入です。${ALLOWED_SOURCES.join(" / ")} のいずれかを記入してください。`,
    };
  }
  if (!ALLOWED_SOURCES.includes(v as AllowedSource)) {
    return {
      ok: false,
      reason: `source「${raw.trim()}」は使えません。${ALLOWED_SOURCES.join(" / ")} のいずれかを記入してください。`,
    };
  }
  return { ok: true, value: v as AllowedSource };
}

export type AiCsvRow = {
  building_id: string;
  building_name: string;
  address: string;
  total_units: string;
  property_type: string;
  source: string;
  note: string;
  line: number;
};

export type CsvError = { line: number; message: string };

/** 突き合わせ相手（DB の現在値。必要な列だけ） */
export type CurrentBuilding = {
  id: string;
  building_name: string | null;
  address: string;
  normalized_address: string;
  prefecture: string | null;
  city: string | null;
  total_units: number | null;
  property_type: string;
  latitude: number | null;
  longitude: number | null;
};

export type FieldChange = {
  field: "building_name" | "address" | "total_units" | "property_type";
  oldValue: string | null;
  newValue: string;
};

export type RowVerdict =
  | "更新可能"
  | "建物名競合"
  | "住所競合"
  | "要確認"
  | "照合不可"
  | "変更なし";

export type PlannedRow = {
  line: number;
  building_id: string | null;
  matched: CurrentBuilding | null;
  verdict: RowVerdict;
  changes: FieldChange[];
  /** 判断の理由。画面にそのまま出す */
  reasons: string[];
  csv: AiCsvRow;
};

export type ImportPlan = {
  rows: PlannedRow[];
  errors: CsvError[];
  counts: {
    total: number;
    updatable: number;
    needsReview: number;
    unmatched: number;
    noChange: number;
    error: number;
  };
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^﻿/, "");
}

/** CSV を読み、列の過不足と building_id の重複を見る */
export function parseAiCsv(text: string): {
  rows: AiCsvRow[];
  errors: CsvError[];
} {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "CSV が空です。" }] };
  }

  const header = table[0].map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: `必須の列がありません: ${missing.join(", ")}` }],
    };
  }

  const at = (name: string) => header.indexOf(name);
  const rows: AiCsvRow[] = [];
  const errors: CsvError[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const get = (name: string) => {
      const index = at(name);
      return index < 0 ? "" : (cells[index] ?? "").trim();
    };

    const buildingId = get("building_id");
    if (buildingId) {
      const first = seen.get(buildingId);
      if (first !== undefined) {
        errors.push({
          line: i,
          message: `building_id が ${first} 行目と重複しています（${buildingId}）。`,
        });
        continue;
      }
      seen.set(buildingId, i);
    }

    rows.push({
      building_id: buildingId,
      building_name: get("building_name"),
      address: get("address"),
      total_units: get("total_units"),
      property_type: get("property_type"),
      source: get("source"),
      note: get("note"),
      line: i,
    });
  }

  return { rows, errors };
}

/** 建物名が入っていない扱いにする値 */
export function isNameEmpty(name: string | null | undefined): boolean {
  const v = (name ?? "").trim();
  return v === "" || v === UNKNOWN_NAME;
}

/**
 * 総世帯数を読む。
 * 「約30」「不明」「0」は数として受け取らない（推測値を入れないため）。
 */
export function parseTotalUnits(
  raw: string,
): { ok: true; value: number } | { ok: false; reason: string | null } {
  const v = raw.trim();
  if (v === "") return { ok: false, reason: null }; // 未記入は更新対象外
  if (!/^\d+$/.test(v)) {
    return { ok: false, reason: `総世帯数「${v}」は数値ではありません。` };
  }
  const n = Number(v);
  if (n <= 0) return { ok: false, reason: `総世帯数「${v}」は 1 以上である必要があります。` };
  return { ok: true, value: n };
}

/**
 * CSV の property_type をアプリの値へ。
 *
 * 調査結果は「賃貸マンション」「分譲マンション」のように書かれることが多い。
 * 賃貸か分譲かが読み取れれば、その語を含む書き方は受け入れる。
 *
 * ただし両方を含む（「賃貸・分譲」など）ものはどちらとも決められないので
 * 変換しない。推測して取り違えるより、要確認に回すほうが安全。
 */
export function parsePropertyType(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string | null } {
  const v = raw.trim();
  if (v === "") return { ok: false, reason: null };

  const exact = PROPERTY_TYPE_FROM_CSV[v];
  if (exact) return { ok: true, value: exact };

  const normalized = v.toLowerCase();
  const isRental = v.includes("賃貸") || normalized.includes("rental");
  const isCondo =
    v.includes("分譲") ||
    v.includes("マンション（分譲）") ||
    normalized.includes("condominium");

  if (isRental && isCondo) {
    return {
      ok: false,
      reason: `物件種別「${v}」は賃貸と分譲の両方を含んでいて判断できません。`,
    };
  }
  if (isRental) return { ok: true, value: "rental" };
  if (isCondo) return { ok: true, value: "condominium" };

  return {
    ok: false,
    reason: `物件種別「${v}」は既存の区分（賃貸 / 分譲 / 不明）に当てはまりません。`,
  };
}

/** 比較用に住所を寄せる（全角・空白・区切りのゆれを吸収） */
function canonicalAddress(address: string): string {
  return address
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－―ー‐‑–—−]/g, "-")
    .replace(/[丁目番地]/g, "-")
    .replace(/号/g, "")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}

export type AddressDecision =
  | { kind: "詳細住所へ更新"; value: string }
  | { kind: "変更なし" }
  | { kind: "競合"; reason: string };

/**
 * 住所を更新してよいか決める。
 *
 * 認めるのは「同じ場所を、より細かく書いただけ」の場合のみ。
 * 町名や丁目・番が食い違うものは、別の建物を指している可能性がある。
 */
export function decideAddress(
  currentAddress: string,
  csvAddress: string,
): AddressDecision {
  const next = csvAddress.trim();
  if (next === "") return { kind: "変更なし" };

  const currentCanonical = canonicalAddress(currentAddress);
  const nextCanonical = canonicalAddress(next);
  if (currentCanonical === nextCanonical) return { kind: "変更なし" };

  const currentBlock = parseBlockKey(currentAddress);
  const nextBlock = parseBlockKey(next);

  if (!currentBlock || !nextBlock) {
    return { kind: "競合", reason: "住所から丁目・番を読み取れませんでした。" };
  }

  if (currentBlock.town !== nextBlock.town) {
    return {
      kind: "競合",
      reason: `町名が違います（${currentBlock.town} → ${nextBlock.town}）。`,
    };
  }
  if (currentBlock.chome !== nextBlock.chome) {
    return {
      kind: "競合",
      reason: `丁目が違います（${currentBlock.chome} → ${nextBlock.chome}）。`,
    };
  }
  if (currentBlock.block !== nextBlock.block) {
    return {
      kind: "競合",
      reason: `番が違います（${currentBlock.block} → ${nextBlock.block}）。`,
    };
  }

  // 同じ街区で、CSV のほうが長い＝号が足された場合だけ認める
  if (!nextCanonical.startsWith(currentCanonical)) {
    return { kind: "競合", reason: "既存住所の続きになっていません。" };
  }

  return { kind: "詳細住所へ更新", value: next };
}

/**
 * CSV の各行について、既存建物と突き合わせて何をするか決める。
 */
export function planAiCsvImport(
  rows: AiCsvRow[],
  current: CurrentBuilding[],
): ImportPlan {
  const byId = new Map(current.map((b) => [b.id, b]));

  // building_id が無い CSV 用。住所で引けるようにしておく
  const byAddress = new Map<string, CurrentBuilding[]>();
  for (const b of current) {
    const key = canonicalAddress(b.address);
    byAddress.set(key, [...(byAddress.get(key) ?? []), b]);
  }

  const planned: PlannedRow[] = [];

  for (const csv of rows) {
    const reasons: string[] = [];
    let matched: CurrentBuilding | null = null;

    // ── 突き合わせ ────────────────────────────────────────
    if (csv.building_id) {
      matched = byId.get(csv.building_id) ?? null;
      if (!matched) reasons.push(`building_id が見つかりません（${csv.building_id}）。`);
    } else if (csv.address) {
      const candidates = byAddress.get(canonicalAddress(csv.address)) ?? [];
      if (candidates.length === 1) {
        matched = candidates[0];
        reasons.push("building_id が無いため住所で照合しました。");
      } else if (candidates.length > 1) {
        reasons.push(`同じ住所に ${candidates.length} 件あり、1 件に絞れません。`);
      } else {
        reasons.push("住所に一致する建物がありません。");
      }
    } else {
      reasons.push("building_id と住所のどちらもありません。");
    }

    if (!matched) {
      planned.push({
        line: csv.line,
        building_id: csv.building_id || null,
        matched: null,
        verdict: "照合不可",
        changes: [],
        reasons,
        csv,
      });
      continue;
    }

    // ── 項目ごとの判断 ────────────────────────────────────
    const changes: FieldChange[] = [];
    let needsReview = false;
    let nameConflict = false;
    let addressConflict = false;

    // 建物名
    const csvName = csv.building_name.trim();
    if (csvName && csvName !== UNKNOWN_NAME) {
      if (isNameEmpty(matched.building_name)) {
        changes.push({
          field: "building_name",
          oldValue: matched.building_name,
          newValue: csvName,
        });
      } else if (matched.building_name?.trim() !== csvName) {
        nameConflict = true;
        reasons.push(
          `既に「${matched.building_name}」が入っています。CSV は「${csvName}」です。`,
        );
      }
    }

    // 住所
    const addressDecision = decideAddress(matched.address, csv.address);
    if (addressDecision.kind === "詳細住所へ更新") {
      changes.push({
        field: "address",
        oldValue: matched.address,
        newValue: addressDecision.value,
      });
    } else if (addressDecision.kind === "競合") {
      addressConflict = true;
      reasons.push(addressDecision.reason);
    }

    // 総世帯数
    const units = parseTotalUnits(csv.total_units);
    if (units.ok) {
      if (matched.total_units !== units.value) {
        changes.push({
          field: "total_units",
          oldValue: matched.total_units === null ? null : String(matched.total_units),
          newValue: String(units.value),
        });
      }
    } else if (units.reason) {
      needsReview = true;
      reasons.push(units.reason);
    }

    // 物件種別
    const propertyType = parsePropertyType(csv.property_type);
    if (propertyType.ok) {
      if (matched.property_type !== propertyType.value) {
        changes.push({
          field: "property_type",
          oldValue: matched.property_type,
          newValue: propertyType.value,
        });
      }
    } else if (propertyType.reason) {
      needsReview = true;
      reasons.push(propertyType.reason);
    }

    // 調査手段。決められた値でなければ、変更内容が正しくても反映しない
    const source = parseSource(csv.source);
    if (!source.ok) {
      needsReview = true;
      reasons.push(source.reason);
    }

    // ── 行としての判定 ────────────────────────────────────
    // 競合や不明点があるものは、変更できる項目があっても自動では入れない。
    let verdict: RowVerdict;
    if (nameConflict) verdict = "建物名競合";
    else if (addressConflict) verdict = "住所競合";
    else if (needsReview) verdict = "要確認";
    else if (changes.length === 0) verdict = "変更なし";
    else verdict = "更新可能";

    planned.push({
      line: csv.line,
      building_id: matched.id,
      matched,
      verdict,
      changes,
      reasons,
      csv,
    });
  }

  const counts = {
    total: planned.length,
    updatable: planned.filter((r) => r.verdict === "更新可能").length,
    needsReview: planned.filter((r) =>
      ["建物名競合", "住所競合", "要確認"].includes(r.verdict),
    ).length,
    unmatched: planned.filter((r) => r.verdict === "照合不可").length,
    noChange: planned.filter((r) => r.verdict === "変更なし").length,
    error: 0,
  };

  return { rows: planned, errors: [], counts };
}

export { blockKeyOf };
