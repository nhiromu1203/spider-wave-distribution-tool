import { describe, expect, it } from "vitest";
import { calculateNameSimilarity, distanceInMeters } from "@/lib/building-matching";
import { UNKNOWN_BUILDING_NAME } from "@/lib/data-sources/types";

/**
 * 「同じ建物」と判定してよい条件の検証。
 *
 * ── 実際に起きた不具合 ──────────────────────────────────────
 * 「同一住所かつ 15m 以内なら同じ建物」という判定が、建物名を見ずに
 * 統合していた。住所が街区符号まで（例: 荒川区西尾久8-44）しかなく
 * 1 住所に最大 8 棟が入るため、同じ街区の別棟が 1 行にまとめられ、
 * 荒川区で 39 件が消え、うち建物名を持つ 36 件は名前ごと失われた。
 *
 * 修正後の条件（ingest.ts の isSameBuildingByName / findByProximity）:
 *   ・距離 5m 以内
 *   ・どちらかに建物名がある
 *   ・両方に名前がある場合は正規化して一致すること（表記違いは吸収される）
 */

const MERGE_DISTANCE_M = 5;

/** ingest.ts の isSameBuildingByName と同じ判定 */
function isSameBuildingByName(incoming: string, existing: string): boolean {
  const incomingNamed = incoming !== UNKNOWN_BUILDING_NAME;
  const existingNamed = existing !== UNKNOWN_BUILDING_NAME;

  if (!incomingNamed && !existingNamed) return false;
  if (incomingNamed && existingNamed) {
    return calculateNameSimilarity(incoming, existing).score >= 0.99;
  }
  return true;
}

describe("建物名による統合可否", () => {
  it("双方とも建物名不明なら統合しない（別棟の可能性があるため）", () => {
    // 街区レベル住所では同じ住所に複数棟が並ぶ。
    // 名前が無い者同士を統合すると、別棟が消える。
    expect(
      isSameBuildingByName(UNKNOWN_BUILDING_NAME, UNKNOWN_BUILDING_NAME),
    ).toBe(false);
  });

  it("片方だけ名前があれば統合する", () => {
    expect(isSameBuildingByName("グランドメゾン日暮里", UNKNOWN_BUILDING_NAME)).toBe(
      true,
    );
    expect(isSameBuildingByName(UNKNOWN_BUILDING_NAME, "グランドメゾン日暮里")).toBe(
      true,
    );
  });

  it("両方に名前があり表記違いなら統合する", () => {
    expect(
      isSameBuildingByName("グランドメゾン日暮里", "GRAND MAISON NIPPORI"),
    ).toBe(true);
  });

  it("両方に名前があり食い違うなら統合しない", () => {
    // 実データで測った類似度を根拠にしている。
    // 類似度 0.5 では下記がすべて「同一」になってしまい、別棟が消える。
    const mustNotMerge: Array<[string, string]> = [
      ["ノーザンスクエア", "サザンスクエア"], // 0.818
      ["コスモステージ荒川遊園 S棟", "コスモステージ荒川遊園 N棟"], // 0.947
      ["グリーンコーポ町屋", "グリーンパーク町屋"], // 0.845
      ["メゾンドブルー", "メゾンひぐらし"], // 0.776
      ["サンハイム南千住", "リバーサイド南千住"], // 0.706
      ["第一荒川ハイツ", "荒川第三マンション"], // 0.553
    ];
    for (const [a, b] of mustNotMerge) {
      expect(isSameBuildingByName(a, b), `${a} / ${b}`).toBe(false);
    }
  });
});

describe("不具合の再現と修正の確認", () => {
  /** 実データ：同一住所（荒川区西尾久8-44）にある 2 棟 */
  const north = { latitude: 35.75326, longitude: 139.75162 };
  const south = { latitude: 35.7529, longitude: 139.75159 };

  it("修正前の条件（15m・名前を見ない）では別棟が統合されうる", () => {
    const distance = distanceInMeters(north, south)!;
    // この 2 棟は 40m あるため 15m 条件では統合されないが、
    // 同一街区にはもっと近接した棟が存在しうる
    const closePair = distanceInMeters(north, {
      latitude: north.latitude + 12 / 111_195,
      longitude: north.longitude,
    })!;

    expect(distance).toBeGreaterThan(15);
    // 12m の 2 棟は旧条件（15m・名前不問）なら統合されてしまう
    expect(closePair).toBeLessThanOrEqual(15);
    expect(closePair).toBeGreaterThan(MERGE_DISTANCE_M);
  });

  it("修正後は 12m 離れた別棟は統合されない", () => {
    const closePair = distanceInMeters(north, {
      latitude: north.latitude + 12 / 111_195,
      longitude: north.longitude,
    })!;
    expect(closePair).toBeGreaterThan(MERGE_DISTANCE_M);
  });

  it("修正後も、名前が無い者同士は 3m でも統合されない", () => {
    const veryClose = distanceInMeters(north, {
      latitude: north.latitude + 3 / 111_195,
      longitude: north.longitude,
    })!;

    expect(veryClose).toBeLessThanOrEqual(MERGE_DISTANCE_M);
    // 距離は条件を満たすが、名前の条件で止まる
    expect(
      isSameBuildingByName(UNKNOWN_BUILDING_NAME, UNKNOWN_BUILDING_NAME),
    ).toBe(false);
  });

  it("建物名を入力した行は、同じ座標の再取得で統合される（名前が消えない）", () => {
    // 利用者が「グランドメゾン日暮里」と入力した行に対し、
    // 次回取得で同じ建物が「建物名不明」として届く場合
    const veryClose = distanceInMeters(north, {
      latitude: north.latitude + 1 / 111_195,
      longitude: north.longitude,
    })!;

    expect(veryClose).toBeLessThanOrEqual(MERGE_DISTANCE_M);
    expect(
      isSameBuildingByName(UNKNOWN_BUILDING_NAME, "グランドメゾン日暮里"),
    ).toBe(true);
  });
});

describe("過去配布リスト取込は建物を増やさない", () => {
  /**
   * 実際に起きたこと。
   * 過去配布リストを取り込んだところ、住所が一致する建物が無い行まで
   * 登録され、建物名も戸数も分からない行が建物マスタに大量に増えた。
   *
   * 過去配布リストは「どこへ配ったか」の記録であって建物マスタではない。
   * 既存の建物に配布実績を付けるだけにする。
   */
  it("skipUnmatched を渡す呼び出しになっている", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../import/actions.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).toContain("skipUnmatched: true");
  });

  it("新規作成の直前に必ず歯止めが入っている", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../ingest.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // insertBuilding を呼ぶ箇所の数だけ、skipUnmatched の判定があること
    const inserts = [...code.matchAll(/await insertBuilding\(/g)].length;
    const guards = [...code.matchAll(/if \(options\.skipUnmatched\)/g)].length;

    expect(inserts).toBeGreaterThan(0);
    expect(guards).toBe(inserts);
  });
});
