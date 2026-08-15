"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeBuildingName } from "@/lib/building-matching";
import { chunkForInFilter } from "./query-batch";
import type { DuplicateCandidateRow, BuildingRow } from "@/lib/supabase/types";

export type ActionResult = { ok: boolean; message: string };

/**
 * 建物名を手入力で登録・修正する。
 *
 * OpenStreetMap には建物名がほとんど入っていないため、配布時に現地で見た名前を
 * その場で登録できるようにする。
 *
 * 一度登録すれば、次回の建物データ取得では
 *   1. 取得元での識別子（source_ref）が一致する行
 *   2. 同一住所かつ座標が 15m 以内の行
 * のどちらかで同じ建物と判定され、既存行に統合される。
 * 取り込み処理は建物名を上書きしないため、入力した名前は失われない。
 */
export async function updateBuildingName(
  buildingId: string,
  buildingName: string,
): Promise<ActionResult> {
  const name = buildingName.trim();
  if (!name) return { ok: false, message: "建物名を入力してください。" };
  if (name.length > 200) {
    return { ok: false, message: "建物名が長すぎます（200文字まで）。" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインが必要です。" };

  // 比較用の名前も更新する。以後は建物名でも重複判定が効くようになる。
  //
  // name_source に manual を立てると、建物名の自動補完がこの行を
  // 対象から外す。人が確認して入れた名前を機械が上書きしないため、
  // ここは必ず一緒に更新すること。
  const { error } = await supabase
    .from("buildings")
    .update({
      building_name: name,
      normalized_building_name: normalizeBuildingName(name),
      name_source: "manual",
      name_decided_at: new Date().toISOString(),
    })
    .eq("id", buildingId);

  if (error) {
    // 同一住所に同じ建物名が既にある場合は一意制約に触れる
    if (error.code === "23505") {
      return {
        ok: false,
        message:
          "同じ住所に同じ建物名が既に登録されています。別の名前にするか、重複候補の確認画面で整理してください。",
      };
    }
    return { ok: false, message: `保存に失敗しました: ${error.message}` };
  }

  revalidatePath("/buildings");
  return { ok: true, message: `建物名を「${name}」に登録しました。` };
}

/** 未配布一覧から選択した物件をまとめて配布済みにする */
export async function markAsDistributed(
  buildingIds: string[],
  input: { distributedDate: string; distributedBy: string; notes: string },
): Promise<ActionResult> {
  if (buildingIds.length === 0) {
    return { ok: false, message: "物件が選択されていません。" };
  }
  if (!input.distributedDate) {
    return { ok: false, message: "配布日を入力してください。" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインが必要です。" };

  const { error } = await supabase.from("distribution_history").insert(
    buildingIds.map((building_id) => ({
      building_id,
      distributed_date: input.distributedDate,
      distributed_by: input.distributedBy.trim() || null,
      notes: input.notes.trim() || null,
      created_by: user.id,
    })),
  );

  if (error) {
    return { ok: false, message: `登録に失敗しました: ${error.message}` };
  }

  // 配布済みになった物件に残っている確認待ちの重複候補は不要になる。
  // ID をまとめて渡すと URL が長くなりすぎるため分割する。
  for (const chunk of chunkForInFilter(buildingIds)) {
    await supabase
      .from("duplicate_candidates")
      .update({
        status: "same",
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .in("new_building_id", chunk)
      .eq("status", "pending");
  }

  revalidatePath("/buildings");
  revalidatePath("/duplicates");

  return {
    ok: true,
    message: `${buildingIds.length}件を配布済みとして登録しました。`,
  };
}

/**
 * 重複候補に対する人間の判断を保存する。
 * 一度判断した組み合わせは再び確認画面に出ない。
 */
export async function resolveDuplicate(
  candidateId: string,
  decision: "same" | "different",
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインが必要です。" };

  const { data: candidate, error: loadError } = await supabase
    .from("duplicate_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (loadError || !candidate) {
    return { ok: false, message: "対象の重複候補が見つかりませんでした。" };
  }
  const row = candidate as DuplicateCandidateRow;

  const { error: updateError } = await supabase
    .from("duplicate_candidates")
    .update({
      status: decision,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", candidateId);

  if (updateError) {
    return { ok: false, message: `保存に失敗しました: ${updateError.message}` };
  }

  if (decision === "same") {
    // 同じ建物 → 過去配布物件の実績を引き継いで配布済みにする
    const { data: existing } = await supabase
      .from("buildings")
      .select("*")
      .eq("id", row.possible_existing_building_id)
      .maybeSingle();

    const source = existing as BuildingRow | null;

    const { error } = await supabase.from("distribution_history").insert({
      building_id: row.new_building_id,
      distributed_date:
        source?.last_distributed_date ?? new Date().toISOString().slice(0, 10),
      distributed_by: null,
      notes: `重複候補確認で「同じ建物」と判断（${source?.building_name ?? "既存物件"}）`,
      created_by: user.id,
    });

    if (error) {
      return { ok: false, message: `配布済み登録に失敗しました: ${error.message}` };
    }
  } else {
    // 別の建物 → 他に確認待ちが残っていなければ未配布へ戻す
    const { count } = await supabase
      .from("duplicate_candidates")
      .select("id", { count: "exact", head: true })
      .eq("new_building_id", row.new_building_id)
      .eq("status", "pending");

    if ((count ?? 0) === 0) {
      await supabase
        .from("buildings")
        .update({ status: "NOT_DISTRIBUTED" })
        .eq("id", row.new_building_id)
        .eq("distribution_count", 0);
    }
  }

  revalidatePath("/buildings");
  revalidatePath("/duplicates");

  return {
    ok: true,
    message:
      decision === "same"
        ? "同じ建物として処理し、未配布一覧から除外しました。"
        : "別の建物として処理し、未配布一覧に戻しました。",
  };
}
