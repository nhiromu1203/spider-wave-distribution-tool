/**
 * 取込機能の型と定数。
 * Server Action ファイル（"use server"）は async 関数しかエクスポートできないため、
 * 定数・型はここに置いてクライアント / サーバー双方から参照する。
 */

import type { IngestOutcome } from "@/lib/buildings/ingest";

/** 1 回の取込で扱う上限。これを超えるファイルは分割してもらう。 */
export const MAX_IMPORT_ROWS = 5000;

/**
 * 取込の種類。
 *
 * CSV / Excel 取込は「過去にチラシを配布した物件一覧」専用。
 * 配布対象候補の建物一覧はエリア選択に応じて建物データソースから
 * 自動取得するため、取込では扱わない。
 */
export type ImportKind = "distributed";

export type ImportSample = {
  outcome: IngestOutcome;
  building_name: string;
  address: string;
  message: string | null;
};

export type ImportPreview = {
  ok: boolean;
  message: string | null;
  counts: Record<IngestOutcome, number>;
  /** 先頭数件のサンプル（画面表示用） */
  samples: ImportSample[];
};

export type ImportResult = ImportPreview & { batchId: string | null };

export const OUTCOME_LABEL: Record<IngestOutcome, string> = {
  inserted: "新規登録",
  merged: "既存物件に配布履歴を追加",
  already_distributed: "配布済みのため除外",
  possible_duplicate: "重複候補",
  skipped: "登録不可",
  excluded_use: "対象外用途のため除外",
};
