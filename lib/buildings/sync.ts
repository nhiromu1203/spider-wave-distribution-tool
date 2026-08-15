"use server";


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
/**
 * かつて取得元（OSM 等）から建物を取り込んでいた処理。
 *
 * ── 取り込みを削除した理由 ──────────────────────────────────
 * 建物マスタの正は CSV 取込に一本化した。
 * 取得元からの登録は、画面を開くだけで走って建物が増え続ける事故を
 * 起こしたため、経路ごと無くしてある（1,108 件へ増えた件）。
 *
 * 呼ばれても DB には一切書き込まない。取得元の設定や対応エリアの
 * 情報は画面表示に使うため残してある。
 * ────────────────────────────────────────────────────────────
 */
export async function syncAreaBuildings(area: {
  prefecture: string;
  city: string;
  town?: string | null;
  chunkIndex?: number | null;
}): Promise<AreaSyncResult> {
  void area;

  return {
    ok: false,
    message:
      "取得元からの建物登録は廃止しました。建物マスタは AI 調査 CSV 取込で管理してください。",
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
}
