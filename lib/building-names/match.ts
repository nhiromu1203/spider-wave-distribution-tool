/**
 * 住所と座標から建物名を突き止める判定。
 *
 * ── 実測に基づく設計（荒川区50件・2026-08-15）────────────────
 * HIGH 15件 / AMBIGUOUS 17件 / NOT_FOUND 18件。
 * AMBIGUOUS の原因は「建物名が見つからない」ではなく
 * 「同じ街区の複数候補を座標で切り分けられない」ことだった。
 *
 * 位置参照の号座標は住居表示の代表点、こちらの座標は建物ポリゴンの
 * 重心で、20〜40m ずれる。同じ街区の隣棟間隔と同程度のため、
 * 1位と2位が僅差になる（実測では 8m 対 8m の同着もあった）。
 *
 * 誤った建物名は配布先の誤りに直結するため、少しでも決めきれない
 * ものは AMBIGUOUS に倒して人が確認する。
 * ────────────────────────────────────────────────────────────
 */

export type NameCandidate = {
  /** 候補の建物名 */
  name: string;
  /** 候補の所在地（号まで） */
  address: string;
  latitude: number;
  longitude: number;
  /** 取得元の識別子（homes_archive など） */
  source: string;
};

export type NameTarget = {
  /** 呼び出し側が結果を紐づけるための識別子 */
  id: string;
  latitude: number;
  longitude: number;
};

export type NameVerdict = "HIGH" | "AMBIGUOUS" | "NOT_FOUND";

export type NameMatch = {
  id: string;
  verdict: NameVerdict;
  /** HIGH のときだけ採用してよい建物名 */
  name: string | null;
  candidate: NameCandidate | null;
  distanceMeters: number | null;
  /** 判定の根拠。画面とログにそのまま出す */
  reason: string;
  /** 人が選べるように、近い順の候補を残す */
  alternatives: Array<{ candidate: NameCandidate; distanceMeters: number }>;
};

export type MatchOptions = {
  /** これより遠い候補は同じ建物とみなさない */
  maxDistanceMeters?: number;
  /** 2位がこの倍率より近いと決めきれないとみなす */
  runnerUpRatio?: number;
};

export const DEFAULT_MAX_DISTANCE_M = 40;
export const DEFAULT_RUNNER_UP_RATIO = 2.5;

export function distanceMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 候補群を対象群に割り当てる。
 *
 * 同じ街区に属する対象と候補をまとめて渡すこと。
 * 1 件ずつ判定すると、2 棟に同じ建物名を付けてしまう
 * （実測で実際に起きた。同じ街区に対象2件・候補1件のケース）。
 */
export function matchBuildingNames(
  targets: NameTarget[],
  candidates: NameCandidate[],
  options: MatchOptions = {},
): NameMatch[] {
  const maxDistance = options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_M;
  const ratio = options.runnerUpRatio ?? DEFAULT_RUNNER_UP_RATIO;

  // 各対象について、近い順に候補を並べる
  const ranked = targets.map((target) => {
    const sorted = candidates
      .map((candidate) => ({
        candidate,
        distanceMeters: distanceMeters(
          target.latitude,
          target.longitude,
          candidate.latitude,
          candidate.longitude,
        ),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    return { target, sorted };
  });

  // 同じ候補を最有力にしている対象が複数あれば、どちらとも決められない。
  // 先に洗い出しておく。
  const claimCount = new Map<string, number>();
  for (const { sorted } of ranked) {
    const best = sorted[0];
    if (!best || best.distanceMeters > maxDistance) continue;
    const key = candidateKey(best.candidate);
    claimCount.set(key, (claimCount.get(key) ?? 0) + 1);
  }

  return ranked.map(({ target, sorted }) => {
    const alternatives = sorted.slice(0, 5);
    const best = sorted[0];
    const runnerUp = sorted[1];

    const base = { id: target.id, alternatives };

    if (!best) {
      return {
        ...base,
        verdict: "NOT_FOUND" as const,
        name: null,
        candidate: null,
        distanceMeters: null,
        reason: "同じ街区に候補が見つかりませんでした。",
      };
    }

    if (best.distanceMeters > maxDistance) {
      return {
        ...base,
        verdict: "AMBIGUOUS" as const,
        name: null,
        candidate: best.candidate,
        distanceMeters: best.distanceMeters,
        reason: `最も近い候補でも ${best.distanceMeters.toFixed(0)}m 離れています（上限 ${maxDistance}m）。`,
      };
    }

    if (runnerUp && runnerUp.distanceMeters < best.distanceMeters * ratio) {
      return {
        ...base,
        verdict: "AMBIGUOUS" as const,
        name: null,
        candidate: best.candidate,
        distanceMeters: best.distanceMeters,
        reason:
          `1位「${best.candidate.name}」${best.distanceMeters.toFixed(0)}m と ` +
          `2位「${runnerUp.candidate.name}」${runnerUp.distanceMeters.toFixed(0)}m が近すぎます。`,
      };
    }

    if ((claimCount.get(candidateKey(best.candidate)) ?? 0) > 1) {
      return {
        ...base,
        verdict: "AMBIGUOUS" as const,
        name: null,
        candidate: best.candidate,
        distanceMeters: best.distanceMeters,
        reason: `同じ街区の別の建物も「${best.candidate.name}」を最有力としています。どちらか判断できません。`,
      };
    }

    return {
      ...base,
      verdict: "HIGH" as const,
      name: best.candidate.name,
      candidate: best.candidate,
      distanceMeters: best.distanceMeters,
      reason:
        `「${best.candidate.name}」(${best.candidate.address}) が ${best.distanceMeters.toFixed(0)}m。` +
        (runnerUp
          ? `2位は ${runnerUp.distanceMeters.toFixed(0)}m で十分離れています。`
          : "同じ街区に他の候補はありません。"),
    };
  });
}

function candidateKey(c: NameCandidate): string {
  return `${c.source}|${c.address}|${c.name}`;
}
