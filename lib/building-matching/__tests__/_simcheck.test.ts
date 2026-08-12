import { describe, expect, it } from "vitest";
import { calculateNameSimilarity } from "../index";

/**
 * 建物名の類似度が「同一建物」と「同一複合の別棟」を区別できるかの実測。
 *
 * 座標が重なる 2 件を統合してよいかの判断に、当初は類似度 0.5 を使っていた。
 * しかし実データを測ると、統合してはいけない組み合わせが 0.947 に達し、
 * 統合すべき組み合わせ（1.000）との間に安全な線が引けないことが分かった。
 *
 * そのため ingest.ts では「正規化して一致（0.99 以上）」を条件にしている。
 * この測定値が変わると同一建物判定の前提が崩れるため、ここで固定しておく。
 */
describe("建物名の類似度（同一建物判定の根拠）", () => {
  it("表記違いの同一建物は 1.0 になる", () => {
    expect(
      calculateNameSimilarity("グランドメゾン日暮里", "GRAND MAISON NIPPORI").score,
    ).toBe(1);
    expect(calculateNameSimilarity("コーポ東尾久", "コーポ東尾久").score).toBe(1);
  });

  it("同一複合の別棟は 1.0 未満に留まる（統合されない）", () => {
    const pairs: Array<[string, string]> = [
      ["コスモステージ荒川遊園 S棟", "コスモステージ荒川遊園 N棟"],
      ["ノーザンスクエア", "サザンスクエア"],
      ["グリーンコーポ町屋", "グリーンパーク町屋"],
      ["メゾンドブルー", "メゾンひぐらし"],
      ["サンハイム南千住", "リバーサイド南千住"],
      ["第一荒川ハイツ", "荒川第三マンション"],
    ];
    for (const [a, b] of pairs) {
      expect(calculateNameSimilarity(a, b).score, `${a} / ${b}`).toBeLessThan(0.99);
    }
  });

  it("閾値 0.5 では別棟を区別できない（採用しない根拠）", () => {
    // 0.5 を使うと下記はすべて「同一」になってしまう
    for (const [a, b] of [
      ["コスモステージ荒川遊園 S棟", "コスモステージ荒川遊園 N棟"],
      ["ノーザンスクエア", "サザンスクエア"],
    ] as Array<[string, string]>) {
      expect(calculateNameSimilarity(a, b).score).toBeGreaterThan(0.5);
    }
  });
});
