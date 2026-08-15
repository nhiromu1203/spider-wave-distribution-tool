"use server";

/**
 * 建物名 CSV の書き出しと取り込み。
 *
 * ── 触ってよいもの ──────────────────────────────────────────
 * building_name / normalized_building_name / name_source / name_decided_at
 *
 * ── 絶対に触らないもの ──────────────────────────────────────
 * status, distribution_count, 配布履歴, total_units, address,
 * latitude, longitude, property_type, prefecture, city
 *
 * update 文に書く列を上の 4 つだけに限っている。
 * 配布実績や住所は建物名の調査結果で動かしてよいものではない。
 * ────────────────────────────────────────────────────────────
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeBuildingName } from "@/lib/building-matching";
import {
  buildUnknownNameCsv,
  parseCompletionCsv,
  planNameUpdates,
  UNKNOWN_NAME,
  type CsvError,
  type CurrentBuilding,
  type PlannedUpdate,
  type SkippedRow,
} from "./csv";

export type ExportResult = {
  ok: boolean;
  message: string;
  /** CSV 本文。ok のときだけ入る */
  csv: string | null;
  fileName: string | null;
  count: number;
};

/** 建物名が分からない物件を CSV にする */
export async function exportUnknownNameCsv(area: {
  prefecture: string | null;
  city: string | null;
}): Promise<ExportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "ログインが必要です。", csv: null, fileName: null, count: 0 };
  }

  let query = supabase
    .from("buildings")
    .select("id,prefecture,city,address,latitude,longitude,building_name")
    .or(`building_name.is.null,building_name.eq."",building_name.eq."${UNKNOWN_NAME}"`)
    .order("address", { ascending: true })
    .limit(10_000);

  // 画面で絞り込んでいる区だけを出す
  if (area.prefecture) query = query.eq("prefecture", area.prefecture);
  if (area.city) query = query.eq("city", area.city);

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      message: `CSV の作成に失敗しました: ${error.message}`,
      csv: null,
      fileName: null,
      count: 0,
    };
  }

  const rows = data ?? [];
  const label = [area.prefecture, area.city].filter(Boolean).join("") || "全地域";

  return {
    ok: true,
    message: `${label} の建物名不明 ${rows.length} 件を書き出しました。`,
    csv: buildUnknownNameCsv(rows),
    fileName: `建物名不明_${label}_${new Date().toISOString().slice(0, 10)}.csv`,
    count: rows.length,
  };
}

export type PreviewResult = {
  ok: boolean;
  message: string;
  updates: PlannedUpdate[];
  skipped: SkippedRow[];
  errors: CsvError[];
  counts: {
    update: number;
    existingName: number;
    ambiguous: number;
    notFound: number;
    alreadySame: number;
    error: number;
  };
};

/**
 * 取り込み内容を確認する。ここでは DB を一切変更しない。
 */
export async function previewNameCsv(text: string): Promise<PreviewResult> {
  const empty: PreviewResult = {
    ok: false,
    message: "",
    updates: [],
    skipped: [],
    errors: [],
    counts: {
      update: 0,
      existingName: 0,
      ambiguous: 0,
      notFound: 0,
      alreadySame: 0,
      error: 0,
    },
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ...empty, message: "ログインが必要です。" };

  const { rows, errors } = parseCompletionCsv(text);
  if (errors.length > 0 && rows.length === 0) {
    return {
      ...empty,
      errors,
      counts: { ...empty.counts, error: errors.length },
      message: "CSV を読み取れませんでした。反映は行いません。",
    };
  }

  // building_id で引き当てる。住所では照合しない。
  const ids = rows.map((r) => r.building_id);
  const current: CurrentBuilding[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("buildings")
      .select("id,address,building_name")
      .in("id", ids.slice(i, i + 200));
    if (error) return { ...empty, message: `照合に失敗しました: ${error.message}` };
    current.push(...((data ?? []) as CurrentBuilding[]));
  }

  const plan = planNameUpdates(rows, current);
  const allErrors = [...errors, ...plan.errors];

  const counts = {
    update: plan.updates.length,
    existingName: plan.skipped.filter((s) => s.reason === "既存名あり").length,
    ambiguous: rows.filter((r) => r.status === "AMBIGUOUS").length,
    notFound: rows.filter((r) => r.status === "NOT_FOUND").length,
    alreadySame: plan.skipped.filter((s) => s.reason === "同じ名前で更新済み").length,
    error: allErrors.length,
  };

  return {
    ok: allErrors.length === 0,
    updates: plan.updates,
    skipped: plan.skipped,
    errors: allErrors,
    counts,
    message:
      allErrors.length > 0
        ? `${allErrors.length} 件のエラーがあります。解消するまで反映できません。`
        : `${counts.update} 件を更新できます。内容を確認して反映してください。`,
  };
}

export type ApplyResult = {
  ok: boolean;
  message: string;
  applied: number;
  failed: number;
};

/**
 * 確認済みの内容だけを反映する。
 * 反映の直前にもう一度 DB を読み、その間に名前が入った行は飛ばす。
 */
export async function applyNameCsv(text: string): Promise<ApplyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインが必要です。", applied: 0, failed: 0 };

  const preview = await previewNameCsv(text);
  if (!preview.ok) {
    return {
      ok: false,
      message: `エラーがあるため反映しませんでした。${preview.message}`,
      applied: 0,
      failed: 0,
    };
  }

  let applied = 0;
  let failed = 0;

  for (const update of preview.updates) {
    // 建物名まわりの列だけを書く。配布実績や住所は対象外。
    const { error } = await supabase
      .from("buildings")
      .update({
        building_name: update.newName,
        normalized_building_name: normalizeBuildingName(update.newName),
        name_source: "csv",
        name_decided_at: new Date().toISOString(),
      })
      .eq("id", update.building_id);

    if (error) {
      failed++;
      continue;
    }

    applied++;
    await supabase.from("building_name_updates").insert({
      building_id: update.building_id,
      old_building_name: update.currentName,
      new_building_name: update.newName,
      source: update.source,
      status: update.status,
      updated_by: user.id,
    });
  }

  revalidatePath("/buildings");

  return {
    ok: failed === 0,
    message:
      failed === 0
        ? `${applied} 件の建物名を更新しました。`
        : `${applied} 件を更新しましたが、${failed} 件で失敗しました。`,
    applied,
    failed,
  };
}
