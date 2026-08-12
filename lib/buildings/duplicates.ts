import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { BuildingRow, DuplicateCandidateRow } from "@/lib/supabase/types";

export type DuplicateCandidateWithBuildings = DuplicateCandidateRow & {
  new_building: BuildingRow | null;
  existing_building: BuildingRow | null;
};

/**
 * 確認待ちの重複候補を取得する。
 * 一度判断済み（same / different）の組み合わせはここに現れない。
 */
export async function fetchPendingDuplicates(
  buildingId?: string | null,
): Promise<DuplicateCandidateWithBuildings[]> {
  const supabase = await createClient();

  let query = supabase
    .from("duplicate_candidates")
    .select(
      `*,
       new_building:buildings!duplicate_candidates_new_building_id_fkey(*),
       existing_building:buildings!duplicate_candidates_possible_existing_building_id_fkey(*)`,
    )
    .eq("status", "pending")
    .order("address_similarity_score", { ascending: false })
    .limit(300);

  if (buildingId) query = query.eq("new_building_id", buildingId);

  const { data, error } = await query;
  if (error) throw new Error(`重複候補の取得に失敗しました: ${error.message}`);

  return (data ?? []) as unknown as DuplicateCandidateWithBuildings[];
}

export type ResolvedDuplicate = DuplicateCandidateWithBuildings;

/** 判断済みの履歴（監査用） */
export async function fetchResolvedDuplicates(
  limit = 50,
): Promise<ResolvedDuplicate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duplicate_candidates")
    .select(
      `*,
       new_building:buildings!duplicate_candidates_new_building_id_fkey(*),
       existing_building:buildings!duplicate_candidates_possible_existing_building_id_fkey(*)`,
    )
    .neq("status", "pending")
    .order("resolved_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`判断履歴の取得に失敗しました: ${error.message}`);
  return (data ?? []) as unknown as ResolvedDuplicate[];
}
