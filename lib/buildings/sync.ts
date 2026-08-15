"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveBuildingDataSource, sourceSupportsArea } from "@/lib/data-sources";
import { ingestBuildings } from "./ingest";
import { isAreaSyncEnabled } from "./sync-config";

export type AreaSyncResult = {
  ok: boolean;
  message: string;
  /** 配布対象として一覧に載った件数 */
  available: number;
  /** 過去配布リストと住所一致し、配布済みとして除外された件数 */
  alreadyDistributed: number;
  /** 重複候補として確認待ちになった件数 */
  possibleDuplicate: number;
  /** 住居用途の集合住宅でないため登録しなかった件数 */
  excludedUse: number;
  /** 用途を判定できなかったために除外した件数（excludedUse の内数） */
  excludedAsUnknownUse: number;
  /** 取得元からの補足（取得件数の内訳・出典など） */
  notes: string[];
  /** 開発確認用のダミーデータかどうか */
  isDevelopment: boolean;
  sourceLabel: string | null;
  /**
   * 分割取得の進み具合。
   *
   * 1 リクエストの実行時間には上限があるため、広い区は区画に分けて
   * 取得する。呼び出し側は done が false のあいだ nextChunkIndex を
   * 渡して呼び直すことで、区全体を取り込める。
   */
  progress: {
    /** 今回処理した区画（0 始まり） */
    chunkIndex: number;
    /** 区画の総数 */
    chunkTotal: number;
    /** 区全体の取り込みが終わったか */
    done: boolean;
    /** 次に渡すべき区画番号。done なら null */
    nextChunkIndex: number | null;
  };
};

/**
 * 選択されたエリアの建物一覧を、有効な建物データソースから取得して DB に取り込む。
 *
 * 取り込み時に過去配布リストとの照合が走り、
 *   ・住所完全一致        → 配布済みのため一覧に載せない
 *   ・住所類似 + 名称類似  → 重複候補として隔離
 *   ・それ以外            → 配布対象として一覧に載る
 * という振り分けが行われる。
 */
export async function syncAreaBuildings(area: {
  prefecture: string;
  city: string;
  town?: string | null;
  /** 取得する区画。未指定なら先頭から */
  chunkIndex?: number | null;
}): Promise<AreaSyncResult> {
  const empty = {
    progress: { chunkIndex: 0, chunkTotal: 1, done: true, nextChunkIndex: null },
    available: 0,
    alreadyDistributed: 0,
    possibleDuplicate: 0,
    excludedUse: 0,
    excludedAsUnknownUse: 0,
    notes: [],
    isDevelopment: false,
    sourceLabel: null,
  };

  if (!area.prefecture || !area.city) {
    return { ok: false, message: "都道府県と市区町村を選択してください。", ...empty };
  }

  // 画面表示・リロード・エリア選択で建物が増えないための歯止め。
  // 画面側だけで止めても、この関数を直接呼ばれれば登録されてしまうため
  // サーバー側で断る。
  if (!isAreaSyncEnabled()) {
    return {
      ok: false,
      message:
        "建物データの自動取得は停止しています。建物マスタは CSV 取込で管理してください。" +
        "（取得元から登録する場合は BUILDING_AUTO_SYNC=1 を設定してください）",
      ...empty,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインが必要です。", ...empty };

  const resolution = resolveBuildingDataSource();
  const source = resolution.active;
  if (!source) {
    // 使えない取得元が選ばれている場合、別の取得元へ勝手に切り替えず
    // 理由をそのまま返す（黙って別データを混ぜないため）
    return {
      ok: false,
      message:
        resolution.unavailableReason ??
        "利用可能な建物データ取得元がありません。BUILDING_DATA_SOURCE を設定してください。",
      ...empty,
      sourceLabel: resolution.selected?.label ?? null,
    };
  }

  // 取得元がその区に対応しているかを先に確認する。
  // 未対応の区で 0 件になったとき、原因が分からないままにしないため。
  if (!sourceSupportsArea(source, { prefecture: area.prefecture, city: area.city })) {
    return {
      ok: false,
      message: `${source.label} は ${area.prefecture} ${area.city} に対応していません。取得元の対応範囲を確認してください。`,
      ...empty,
      isDevelopment: source.isDevelopment,
      sourceLabel: source.label,
    };
  }

  try {
    const fetched = await source.fetchByArea({
      prefecture: area.prefecture,
      city: area.city,
      town: area.town ?? null,
      chunkIndex: area.chunkIndex ?? 0,
    });

    const chunkIndex = fetched.chunk?.index ?? 0;
    const chunkTotal = fetched.chunk?.total ?? 1;
    const done = chunkIndex >= chunkTotal - 1;
    const progress = {
      chunkIndex,
      chunkTotal,
      done,
      nextChunkIndex: done ? null : chunkIndex + 1,
    };

    if (fetched.buildings.length === 0) {
      // 区画によっては 1 件も無いことがある（河川敷・工業地帯など）。
      // 取得そのものは成功しているため、次の区画へ進める。
      return {
        ok: true,
        message:
          chunkTotal > 1
            ? `${area.city} の区画 ${chunkIndex + 1}/${chunkTotal} に対象の建物はありませんでした。`
            : `${area.city}${area.town ? ` ${area.town}` : ""} の建物データは取得元にありませんでした。`,
        ...empty,
        progress,
        notes: fetched.notes ?? [],
        isDevelopment: source.isDevelopment,
        sourceLabel: source.label,
      };
    }

    const summary = await ingestBuildings(supabase, fetched.buildings, {
      source: "data_source",
      userId: user.id,
    });

    revalidatePath("/buildings");
    revalidatePath("/duplicates");

    const available = summary.counts.inserted + summary.counts.merged;

    return {
      ok: true,
      message:
        chunkTotal > 1
          ? `${source.label} から ${fetched.buildings.length} 件を取得しました（区画 ${chunkIndex + 1}/${chunkTotal}）。`
          : `${source.label} から ${fetched.buildings.length} 件を取得しました。`,
      progress,
      available,
      alreadyDistributed: summary.counts.already_distributed,
      possibleDuplicate: summary.counts.possible_duplicate,
      excludedUse: summary.counts.excluded_use,
      excludedAsUnknownUse: summary.excludedAsUnknownUse,
      notes: fetched.notes ?? [],
      isDevelopment: source.isDevelopment,
      sourceLabel: source.label,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `建物データの取得に失敗しました: ${error.message}`
          : "建物データの取得に失敗しました。",
      ...empty,
      isDevelopment: source.isDevelopment,
      sourceLabel: source.label,
    };
  }
}
