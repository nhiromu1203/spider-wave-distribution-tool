"use server";

/**
 * AI 調査 CSV の取込。
 *
 * ── 触ってよい列 ────────────────────────────────────────────
 * building_name / normalized_building_name /
 * address / normalized_address /
 * total_units / property_type / name_source / name_decided_at
 *
 * ── 絶対に触らないもの ──────────────────────────────────────
 * status, distribution_count, last_distributed_date,
 * distribution_history, duplicate_candidates, source_ref,
 * latitude, longitude, prefecture, city
 *
 * 建物情報の補完だけを行う。配布実績と配布済み判定は
 * 調査結果で動かしてよいものではない。
 * ────────────────────────────────────────────────────────────
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeAddress,
  normalizeAddressDetailed,
  normalizeBuildingName,
} from "@/lib/building-matching";
import { findPrefectureByCity } from "@/lib/data-sources/areas";
import {
  AI_CSV_COLUMNS,
  parseAiCsv,
  planAiCsvImport,
  type CurrentBuilding,
  type ImportPlan,
  type PlannedRow,
} from "./plan";

/** 取込時の指定 */
export type ImportOptions = {
  /** 既存値も CSV で置き換える（建物名・総世帯数・所有形態・建物種別のみ） */
  overwriteExisting?: boolean;
  /** DB に無い建物を新規登録する */
  allowCreate?: boolean;
};

export type PreviewResult = {
  ok: boolean;
  message: string;
  plan: ImportPlan;
};

/** ChatGPT へ渡すための空テンプレート */
export async function buildTemplateCsv(): Promise<string> {
  return `﻿${AI_CSV_COLUMNS.join(",")}\r\n`;
}

/**
 * 取込内容を確認する。ここでは DB を一切変更しない。
 */
export async function previewAiCsv(
  text: string,
  options: ImportOptions = {},
): Promise<PreviewResult> {
  const emptyPlan: ImportPlan = {
    rows: [],
    errors: [],
    counts: {
      total: 0,
      updatable: 0,
      creatable: 0,
      needsReview: 0,
      unmatched: 0,
      noChange: 0,
      error: 0,
    },
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "ログインが必要です。", plan: emptyPlan };
  }

  const { rows, errors } = parseAiCsv(text);
  if (rows.length === 0) {
    return {
      ok: false,
      message: "CSV を読み取れませんでした。反映は行いません。",
      plan: { ...emptyPlan, errors, counts: { ...emptyPlan.counts, error: errors.length } },
    };
  }

  // ── 突き合わせ相手を集める ────────────────────────────────
  const columns =
    "id,building_name,address,normalized_address,prefecture,city,total_units,property_type,building_type,latitude,longitude";
  const current: CurrentBuilding[] = [];

  const ids = rows.map((r) => r.building_id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("buildings")
      .select(columns)
      .in("id", ids.slice(i, i + 200));
    if (error) {
      return { ok: false, message: `照合に失敗しました: ${error.message}`, plan: emptyPlan };
    }
    current.push(...((data ?? []) as CurrentBuilding[]));
  }

  // building_id が無い行は住所で引く。件数が読めないため区単位で読み込む
  const withoutId = rows.filter((r) => !r.building_id);
  if (withoutId.length > 0) {
    const { data, error } = await supabase
      .from("buildings")
      .select(columns)
      .limit(20_000);
    if (error) {
      return { ok: false, message: `照合に失敗しました: ${error.message}`, plan: emptyPlan };
    }
    const known = new Set(current.map((c) => c.id));
    for (const b of (data ?? []) as CurrentBuilding[]) {
      if (!known.has(b.id)) current.push(b);
    }
  }

  const plan = planAiCsvImport(rows, current, {
    overwriteExisting: options.overwriteExisting === true,
    allowCreate: options.allowCreate === true,
  });
  plan.errors = errors;
  plan.counts.error = errors.length;

  return {
    ok: true,
    message:
      `${plan.counts.total} 件を読み取りました。` +
      `更新 ${plan.counts.updatable} 件 / 新規登録 ${plan.counts.creatable} 件 / ` +
      `要確認 ${plan.counts.needsReview} 件 / 照合不可 ${plan.counts.unmatched} 件 / ` +
      `変更なし ${plan.counts.noChange} 件`,
    plan,
  };
}

export type ApplyResult = {
  ok: boolean;
  message: string;
  batchId: string | null;
  /** 既存建物を更新した件数 */
  applied: number;
  /** 新しく登録した件数 */
  created: number;
  failed: number;
};

/**
 * 選ばれた行だけを反映する。
 *
 * 反映の直前にもう一度判断し直す。画面を開いている間に
 * 他の人が値を入れていた場合、その内容を壊さないため。
 */
export async function applyAiCsv(
  text: string,
  selectedLines: number[],
  fileName: string | null,
  options: ImportOptions = {},
): Promise<ApplyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      message: "ログインが必要です。",
      batchId: null,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  const preview = await previewAiCsv(text, options);
  if (!preview.ok) {
    return {
      ok: false,
      message: `エラーがあるため反映しませんでした。${preview.message}`,
      batchId: null,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  const selected = new Set(selectedLines);
  // 競合・要確認・照合不可は、選ばれていても反映しない
  const targets = preview.plan.rows.filter(
    (r) => selected.has(r.line) && r.verdict === "更新可能" && r.changes.length > 0,
  );
  const newRows = preview.plan.rows.filter(
    (r) => selected.has(r.line) && r.verdict === "新規登録",
  );

  if (targets.length === 0 && newRows.length === 0) {
    return {
      ok: true,
      message: "反映できる行がありませんでした。",
      batchId: null,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  const { data: batch, error: batchError } = await supabase
    .from("ai_csv_batches")
    .insert({
      file_name: fileName,
      source: targets[0]?.csv.source ?? null,
      row_count: preview.plan.counts.total,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return {
      ok: false,
      message: `取込の記録に失敗しました: ${batchError?.message ?? "不明"}`,
      batchId: null,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  let applied = 0;
  let created = 0;
  let failed = 0;

  for (const row of targets) {
    const patch = buildPatch(row);
    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase
      .from("buildings")
      .update(patch)
      .eq("id", row.building_id as string);

    if (error) {
      failed++;
      continue;
    }
    applied++;

    await supabase.from("building_field_updates").insert(
      row.changes.map((c) => ({
        batch_id: batch.id,
        building_id: row.building_id,
        field_name: c.field,
        old_value: c.oldValue,
        new_value: c.newValue,
        source: row.csv.source || null,
        note: row.csv.note || null,
        updated_by: user.id,
      })),
    );
  }

  // ── 新規登録 ──────────────────────────────────────────────
  // 既存建物には触れない。配布履歴も作らない（配布実績は別の操作）。
  for (const row of newRows) {
    const insert = buildInsert(row);
    if (!insert) {
      failed++;
      continue;
    }

    const { data: inserted, error } = await supabase
      .from("buildings")
      .insert(insert)
      .select("id")
      .single();

    if (error || !inserted) {
      failed++;
      continue;
    }
    created++;

    await supabase.from("building_field_updates").insert(
      row.changes.map((c) => ({
        batch_id: batch.id,
        building_id: inserted.id,
        field_name: c.field,
        old_value: null,
        new_value: c.newValue,
        source: row.csv.source || null,
        note: row.csv.note || null,
        updated_by: user.id,
      })),
    );
  }

  await supabase
    .from("ai_csv_batches")
    .update({ applied_count: applied + created })
    .eq("id", batch.id);

  revalidatePath("/buildings");
  revalidatePath("/import");

  return {
    ok: failed === 0,
    message:
      `${applied} 件を更新、${created} 件を新規登録しました。` +
      (failed > 0 ? `${failed} 件で失敗しました。` : ""),
    batchId: batch.id,
    applied,
    created,
    failed,
  };
}

/**
 * 新規登録する行を組み立てる。
 *
 * 状態や配布実績には触れない。既定値のまま（未配布・配布回数0）で入る。
 */
function buildInsert(row: PlannedRow): Record<string, unknown> | null {
  const get = (field: string) =>
    row.changes.find((c) => c.field === field)?.newValue ?? null;

  const name = get("building_name");
  const address = get("address");
  if (!name || !address) return null;

  const detail = normalizeAddressDetailed(address);
  const city = extractCity(address);

  const insert: Record<string, unknown> = {
    building_name: name,
    normalized_building_name: normalizeBuildingName(name),
    address,
    normalized_address: detail.normalized,
    prefecture: detail.prefecture ?? (city ? findPrefectureByCity(city) : null),
    city,
    source: "import",
  };

  const units = get("total_units");
  if (units) insert.total_units = Number(units);

  const propertyType = get("property_type");
  if (propertyType) insert.property_type = propertyType;

  const buildingType = get("building_type");
  if (buildingType) insert.building_type = buildingType;

  return insert;
}

/** 住所から市区町村を取り出す。取れなければ null */
function extractCity(address: string): string | null {
  return address.match(/([^\s都道府県]+?[市区町村])/)?.[1] ?? null;
}

/** 更新する列を組み立てる。建物情報の列以外は絶対に入れない */
function buildPatch(row: PlannedRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const change of row.changes) {
    if (change.field === "building_name") {
      patch.building_name = change.newValue;
      patch.normalized_building_name = normalizeBuildingName(change.newValue);
      patch.name_source = "csv";
      patch.name_decided_at = new Date().toISOString();
    } else if (change.field === "address") {
      patch.address = change.newValue;
      patch.normalized_address = normalizeAddress(change.newValue);
    } else if (change.field === "total_units") {
      patch.total_units = Number(change.newValue);
    } else if (change.field === "property_type") {
      patch.property_type = change.newValue;
    } else if (change.field === "building_type") {
      patch.building_type = change.newValue;
    }
  }

  return patch;
}

/**
 * 取込単位で建物情報を元に戻す。
 * 戻すのは履歴に残した項目だけで、配布実績や状態には触れない。
 */
export async function rollbackAiCsvBatch(batchId: string): Promise<ApplyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      message: "ログインが必要です。",
      batchId,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  const { data: history, error } = await supabase
    .from("building_field_updates")
    .select("building_id,field_name,old_value")
    .eq("batch_id", batchId)
    .order("id", { ascending: false });

  if (error) {
    return {
      ok: false,
      message: `履歴の取得に失敗しました: ${error.message}`,
      batchId,
      applied: 0,
      created: 0,
      failed: 0,
    };
  }

  let restored = 0;
  let failed = 0;

  for (const h of history ?? []) {
    const field = h.field_name as string;
    const patch: Record<string, unknown> = {};

    if (field === "building_name") {
      patch.building_name = h.old_value ?? "";
      patch.normalized_building_name = normalizeBuildingName(h.old_value ?? "");
    } else if (field === "address") {
      if (!h.old_value) continue; // 住所は空に戻せない
      patch.address = h.old_value;
      patch.normalized_address = normalizeAddress(h.old_value);
    } else if (field === "total_units") {
      patch.total_units = h.old_value === null ? null : Number(h.old_value);
    } else if (field === "property_type") {
      patch.property_type = h.old_value ?? "unknown";
    } else if (field === "building_type") {
      patch.building_type = h.old_value;
    } else continue;

    const { error: updateError } = await supabase
      .from("buildings")
      .update(patch)
      .eq("id", h.building_id as string);

    if (updateError) failed++;
    else restored++;
  }

  await supabase
    .from("ai_csv_batches")
    .update({ rolled_back_at: new Date().toISOString() })
    .eq("id", batchId);

  revalidatePath("/buildings");

  return {
    ok: failed === 0,
    message:
      failed === 0
        ? `${restored} 項目を元に戻しました。`
        : `${restored} 項目を戻しましたが、${failed} 件で失敗しました。`,
    batchId,
    applied: restored,
    created: 0,
    failed,
  };
}
