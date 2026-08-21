"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeBuildings,
  ingestBuildings,
  reconcileDistributionStatus,
  type BuildingInput,
  type IngestOutcome,
} from "@/lib/buildings/ingest";
import { parseAddressParts } from "@/lib/building-matching";
import {
  MAX_IMPORT_ROWS,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
} from "./types";

function toSamples(
  results: Array<{
    input: BuildingInput;
    outcome: IngestOutcome;
    message: string | null;
  }>,
  limit = 30,
) {
  // 問題のある行を優先して見せる
  const priority: IngestOutcome[] = [
    "skipped",
    "possible_duplicate",
    "already_distributed",
    "merged",
    "inserted",
  ];
  return [...results]
    .sort((a, b) => priority.indexOf(a.outcome) - priority.indexOf(b.outcome))
    .slice(0, limit)
    .map((r) => ({
      outcome: r.outcome,
      building_name: r.input.building_name,
      address: r.input.address,
      message: r.message,
    }));
}

/** 登録は行わず、判定結果だけを返す */
export async function previewImport(
  inputs: BuildingInput[],
): Promise<ImportPreview> {
  const empty = {
    inserted: 0,
    merged: 0,
    already_distributed: 0,
    possible_duplicate: 0,
    skipped: 0,
    excluded_use: 0,
  };

  if (inputs.length === 0) {
    return { ok: false, message: "取り込む行がありません。", counts: empty, samples: [] };
  }
  if (inputs.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      message: `一度に取り込めるのは ${MAX_IMPORT_ROWS.toLocaleString("ja-JP")} 行までです。ファイルを分割してください。`,
      counts: empty,
      samples: [],
    };
  }

  const supabase = await createClient();

  try {
    const summary = await analyzeBuildings(supabase, inputs);
    return {
      ok: true,
      message: null,
      counts: summary.counts,
      samples: toSamples(summary.results),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "解析に失敗しました。",
      counts: empty,
      samples: [],
    };
  }
}

/** プレビューを確認したうえで実際に DB へ登録する */
export async function runImport(
  inputs: BuildingInput[],
  meta: { fileName: string; kind: ImportKind; mapping: Record<string, string | null> },
): Promise<ImportResult> {
  const preview = await previewImport(inputs);
  if (!preview.ok) return { ...preview, batchId: null };

  const supabase = await createClient();

  try {
    const summary = await ingestBuildings(supabase, inputs, {
      source: "import",
      // 過去配布リストは配布実績の記録であり、建物マスタではない。
      // 住所が一致する建物が無い行で新しい建物を作らない。
      skipUnmatched: true,
      userId: null,
    });

    // 先にエリアの建物を取得していた場合、その一覧側にも配布済み判定を反映させる。
    // これにより「取込の順序」によって二重配布が発生することを防ぐ。
    const cities = inputs
      .map((i) => parseAddressParts(i.address).city)
      .filter((c): c is string => !!c);
    const reconciled = await reconcileDistributionStatus(supabase, cities);

    const { data: batch } = await supabase
      .from("import_batches")
      .insert({
        file_name: meta.fileName,
        kind: meta.kind,
        total_rows: inputs.length,
        inserted_rows: summary.counts.inserted,
        merged_rows: summary.counts.merged,
        duplicate_rows:
          summary.counts.possible_duplicate + summary.counts.already_distributed,
        skipped_rows: summary.counts.skipped,
        column_mapping: meta.mapping,
        created_by: null,
      })
      .select("id")
      .single();

    revalidatePath("/buildings");
    revalidatePath("/duplicates");

    const reconcileNote =
      reconciled.confirmed > 0 || reconciled.possibleDuplicate > 0
        ? ` 既に一覧にあった建物のうち ${reconciled.confirmed} 件を配布済みとして除外し、${reconciled.possibleDuplicate} 件を重複候補にしました。`
        : "";

    return {
      ok: true,
      message: `取込が完了しました。${reconcileNote}`,
      counts: summary.counts,
      samples: toSamples(summary.results),
      batchId: (batch as { id: string } | null)?.id ?? null,
    };
  } catch (error) {
    return {
      ...preview,
      ok: false,
      message: error instanceof Error ? error.message : "取込に失敗しました。",
      batchId: null,
    };
  }
}
