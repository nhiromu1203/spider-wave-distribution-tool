import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  matchBuildingNames,
  type NameCandidate,
} from "../match";

/**
 * 荒川区50件の実測で観測した状況を、そのまま条件として固定する。
 * 数値は実測値であり、通すために調整したものではない。
 */

function candidate(
  name: string,
  address: string,
  latitude: number,
  longitude: number,
): NameCandidate {
  return { name, address, latitude, longitude, source: "homes_archive" };
}

describe("距離の計算", () => {
  it("同じ点なら 0m", () => {
    expect(distanceMeters(35.73, 139.78, 35.73, 139.78)).toBe(0);
  });

  it("緯度 0.001 度は約 111m", () => {
    expect(distanceMeters(35.73, 139.78, 35.731, 139.78)).toBeCloseTo(111, 0);
  });
});

describe("単独候補が十分近いとき", () => {
  it("HIGH になる（実測 #1 メゾン丸十 8m）", () => {
    const [r] = matchBuildingNames(
      [{ id: "1", latitude: 35.7301744, longitude: 139.7710092 }],
      [candidate("メゾン丸十", "西日暮里2-26-10", 35.7301, 139.771)],
    );

    expect(r.verdict).toBe("HIGH");
    expect(r.name).toBe("メゾン丸十");
  });
});

describe("決めきれない状況は必ず AMBIGUOUS にする", () => {
  it("1位と2位が僅差なら採用しない（実測 #5 は 8m 対 8m の同着）", () => {
    const target = { id: "5", latitude: 35.7284546, longitude: 139.7794818 };
    const [r] = matchBuildingNames(
      [target],
      [
        candidate("アイオス日暮里", "東日暮里4-32-10", 35.728493, 139.779404),
        candidate("プレール・ドゥーク日暮里", "東日暮里4-32-11", 35.72846, 139.77955),
      ],
    );

    expect(r.verdict).toBe("AMBIGUOUS");
    expect(r.name).toBeNull();
    expect(r.reason).toContain("近すぎます");
  });

  it("最も近い候補でも遠すぎるなら採用しない（実測 #32 は 52m）", () => {
    const [r] = matchBuildingNames(
      [{ id: "32", latitude: 35.732158, longitude: 139.7764009 }],
      [candidate("ルーデンス日暮里", "東日暮里6-33", 35.7326, 139.7764)],
    );

    expect(r.verdict).toBe("AMBIGUOUS");
    expect(r.name).toBeNull();
  });

  it("候補が無ければ NOT_FOUND", () => {
    const [r] = matchBuildingNames(
      [{ id: "3", latitude: 35.7269504, longitude: 139.7781452 }],
      [],
    );

    expect(r.verdict).toBe("NOT_FOUND");
    expect(r.name).toBeNull();
  });
});

describe("同じ建物名を2棟に付けない", () => {
  /**
   * 実測 #34 と #35 で実際に起きた。
   * 東日暮里6丁目26番に対象が2件あるのに候補が1件しかなく、
   * 1件ずつ判定したため両方に「ハイツパイン・フォレスト」を付けていた。
   * 必ず片方は誤りになる。
   */
  it("同じ街区に対象2件・候補1件なら、両方とも AMBIGUOUS", () => {
    const only = candidate(
      "ハイツパイン・フォレスト",
      "東日暮里6-26-10",
      35.73252,
      139.77729,
    );

    const results = matchBuildingNames(
      [
        { id: "34", latitude: 35.7325213, longitude: 139.777288 },
        { id: "35", latitude: 35.7323057, longitude: 139.7771357 },
      ],
      [only],
    );

    expect(results.map((r) => r.verdict)).toEqual(["AMBIGUOUS", "AMBIGUOUS"]);
    expect(results.every((r) => r.name === null)).toBe(true);
    expect(results[0].reason).toContain("別の建物も");
  });

  it("対象2件に候補2件が十分離れて対応するなら、両方 HIGH", () => {
    const results = matchBuildingNames(
      [
        { id: "a", latitude: 35.7325, longitude: 139.7773 },
        { id: "b", latitude: 35.7300, longitude: 139.7773 },
      ],
      [
        candidate("北ハイツ", "6-26-10", 35.73251, 139.77731),
        candidate("南ハイツ", "6-26-20", 35.73001, 139.77731),
      ],
    );

    expect(results.map((r) => r.verdict)).toEqual(["HIGH", "HIGH"]);
    expect(results.map((r) => r.name)).toEqual(["北ハイツ", "南ハイツ"]);
  });
});

describe("人が選べる材料を残す", () => {
  it("AMBIGUOUS でも候補一覧を返す", () => {
    const [r] = matchBuildingNames(
      [{ id: "15", latitude: 35.7260589, longitude: 139.7791112 }],
      [
        candidate("イニシア日暮里アベニュー", "東日暮里4-35-13", 35.726204, 139.778992),
        candidate("S-RESIDENCE東日暮里", "東日暮里4-35-10", 35.725864, 139.779114),
      ],
    );

    expect(r.verdict).toBe("AMBIGUOUS");
    expect(r.alternatives).toHaveLength(2);
    expect(r.alternatives[0].distanceMeters).toBeLessThan(
      r.alternatives[1].distanceMeters,
    );
  });
});
