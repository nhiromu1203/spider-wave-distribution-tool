/**
 * 建物名補完の型。
 *
 * 取得元（どのサイトから候補を集めるか）と、判定（どれを採用するか）を
 * 切り離しておく。取得元を足すときに判定側を触らずに済む。
 */

/** 取得元から返ってくる、座標が付く前の候補 */
export type RawNameCandidate = {
  name: string;
  /** 号まで含む所在地。座標に変換するために使う */
  address: string;
  /** 取得元の識別子 */
  source: string;
};

/** 建物名を補完した結果（1 件分） */
export type NameCompletion = {
  buildingId: string;
  /** 採用してよい建物名。HIGH のときだけ入る */
  name: string | null;
  verdict: "HIGH" | "AMBIGUOUS" | "NOT_FOUND";
  reason: string;
  /** 人が選ぶための候補（近い順） */
  candidates: Array<{
    name: string;
    address: string;
    source: string;
    distanceMeters: number;
  }>;
};

export type NameCompletionSummary = {
  /** 判定した件数 */
  examined: number;
  /** HIGH として自動採用した件数 */
  applied: number;
  /** 人の確認が必要な件数 */
  ambiguous: number;
  /** 候補が見つからなかった件数 */
  notFound: number;
  /** 取得済みのため問い合わせを省いた街区の数 */
  skippedBlocks: number;
  /** 問い合わせた街区の数 */
  fetchedBlocks: number;
  notes: string[];
};
