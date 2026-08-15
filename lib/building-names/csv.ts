/**
 * 建物名を CSV で受け渡しするための処理。
 *
 * ── 運用 ────────────────────────────────────────────────────
 * 1. 建物名が分からない物件を CSV で書き出す
 * 2. 別途 AI などで調べ、建物名と確度を書き足してもらう
 * 3. その CSV を取り込み、確度の高いものだけ反映する
 *
 * ここは外部と通信しない純粋な処理にしてある。
 * 判定と副作用を分けておくと、取り違えの検証がしやすい。
 * ────────────────────────────────────────────────────────────
 */

/** 取り込み CSV で許可する確度。これ以外は行エラーにする */
export const ALLOWED_STATUSES = [
  "CONFIRMED",
  "HIGH",
  "AMBIGUOUS",
  "NOT_FOUND",
] as const;
export type CompletionStatus = (typeof ALLOWED_STATUSES)[number];

/** 建物名を書き換えてよい確度 */
const UPDATABLE: CompletionStatus[] = ["CONFIRMED", "HIGH"];

export const UNKNOWN_NAME = "（建物名不明）";

/** 書き出し CSV の列 */
export const EXPORT_COLUMNS = [
  "building_id",
  "prefecture",
  "city",
  "address",
  "latitude",
  "longitude",
  "current_building_name",
] as const;

/** 取り込み CSV の必須列 */
export const IMPORT_COLUMNS = [
  "building_id",
  "address",
  "building_name",
  "status",
  "source",
  "note",
] as const;

export type ExportRow = {
  id: string;
  prefecture: string | null;
  city: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  building_name: string | null;
};

/** 値に区切り文字や引用符が含まれても壊れない形にする */
function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 建物名不明の物件を CSV にする。
 * Excel で開いても文字化けしないよう BOM を付ける。
 */
export function buildUnknownNameCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.prefecture,
        r.city,
        r.address,
        r.latitude,
        r.longitude,
        r.building_name ?? "",
      ]
        .map(escapeCell)
        .join(","),
    );
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}

/** 引用符・改行・BOM を扱う最小限の CSV 読み取り */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];

    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      // 次の \n でまとめて処理する
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type CompletionRow = {
  building_id: string;
  address: string;
  building_name: string;
  status: CompletionStatus;
  source: string;
  note: string;
  /** CSV 上の行番号（見出しを除いて1始まり）。エラー表示に使う */
  line: number;
};

export type CsvError = { line: number; message: string };

/**
 * 取り込み CSV を読み、行ごとに検証する。
 *
 * 列不足や確度の誤りは、DB を触る前にここで弾く。
 */
export function parseCompletionCsv(text: string): {
  rows: CompletionRow[];
  errors: CsvError[];
} {
  const table = parseCsv(text);
  const errors: CsvError[] = [];

  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "CSV が空です。" }] };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 0,
          message: `必須の列がありません: ${missing.join(", ")}`,
        },
      ],
    };
  }

  const index = Object.fromEntries(
    IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)]),
  ) as Record<(typeof IMPORT_COLUMNS)[number], number>;

  const rows: CompletionRow[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < table.length; i++) {
    const line = i;
    const cells = table[i];
    const get = (c: (typeof IMPORT_COLUMNS)[number]) =>
      (cells[index[c]] ?? "").trim();

    const buildingId = get("building_id");
    const status = get("status").toUpperCase();
    const name = get("building_name");

    if (!buildingId) {
      errors.push({ line, message: "building_id が空です。" });
      continue;
    }

    const duplicated = seen.get(buildingId);
    if (duplicated !== undefined) {
      errors.push({
        line,
        message: `building_id が ${duplicated} 行目と重複しています（${buildingId}）。`,
      });
      continue;
    }
    seen.set(buildingId, line);

    if (!ALLOWED_STATUSES.includes(status as CompletionStatus)) {
      errors.push({
        line,
        message: `status が不正です（${status || "空"}）。許可値: ${ALLOWED_STATUSES.join(" / ")}`,
      });
      continue;
    }

    if (UPDATABLE.includes(status as CompletionStatus) && !name) {
      errors.push({
        line,
        message: `status が ${status} なのに building_name が空です。`,
      });
      continue;
    }

    rows.push({
      building_id: buildingId,
      address: get("address"),
      building_name: name,
      status: status as CompletionStatus,
      source: get("source"),
      note: get("note"),
      line,
    });
  }

  return { rows, errors };
}

/** DB 側の現在値（照合に必要な分だけ） */
export type CurrentBuilding = {
  id: string;
  address: string;
  building_name: string | null;
};

export type PlannedUpdate = {
  building_id: string;
  address: string;
  currentName: string | null;
  newName: string;
  status: CompletionStatus;
  source: string;
};

export type SkippedRow = {
  building_id: string;
  address: string;
  currentName: string | null;
  proposedName: string;
  status: CompletionStatus;
  reason:
    | "既存名あり"
    | "確度が不足"
    | "同じ名前で更新済み"
    | "該当する建物がない";
};

export type UpdatePlan = {
  updates: PlannedUpdate[];
  skipped: SkippedRow[];
  errors: CsvError[];
};

/** 建物名が入っていない扱いにする値 */
export function isNameEmpty(name: string | null | undefined): boolean {
  const v = (name ?? "").trim();
  return v === "" || v === UNKNOWN_NAME;
}

/**
 * 取り込み内容と現在の DB を突き合わせ、何をするか決める。
 *
 * ここでは DB を触らない。決めた内容をそのまま画面に出し、
 * 人が確認してから初めて反映する。
 */
export function planNameUpdates(
  rows: CompletionRow[],
  current: CurrentBuilding[],
): UpdatePlan {
  const byId = new Map(current.map((c) => [c.id, c]));
  const updates: PlannedUpdate[] = [];
  const skipped: SkippedRow[] = [];
  const errors: CsvError[] = [];

  for (const row of rows) {
    const target = byId.get(row.building_id);

    // 住所ではなく building_id で照合する。住所は重複するため。
    if (!target) {
      errors.push({
        line: row.line,
        message: `building_id が見つかりません（${row.building_id}）。`,
      });
      continue;
    }

    const base = {
      building_id: row.building_id,
      address: target.address,
      currentName: target.building_name,
      proposedName: row.building_name,
      status: row.status,
    };

    if (!UPDATABLE.includes(row.status)) {
      skipped.push({ ...base, reason: "確度が不足" });
      continue;
    }

    // 既に名前が入っているものは触らない
    if (!isNameEmpty(target.building_name)) {
      skipped.push({
        ...base,
        reason:
          target.building_name?.trim() === row.building_name.trim()
            ? "同じ名前で更新済み"
            : "既存名あり",
      });
      continue;
    }

    updates.push({
      building_id: row.building_id,
      address: target.address,
      currentName: target.building_name,
      newName: row.building_name,
      status: row.status,
      source: row.source,
    });
  }

  return { updates, skipped, errors };
}
