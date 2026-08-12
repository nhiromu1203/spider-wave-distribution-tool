import { describe, expect, it } from "vitest";
import { normalizeBuildingNameDetailed } from "../normalizeBuildingName";
import { calculateNameSimilarity } from "../calculateNameSimilarity";

describe("normalizeBuildingName", () => {
  it("全角英数字を半角化し、英字を小文字に、スペースと記号を除去する", () => {
    const result = normalizeBuildingNameDetailed("ＧＲＡＮＤ　ＭＡＩＳＯＮ・日暮里　Ⅱ");
    expect(result.normalized).not.toMatch(/[\s　・]/);
    expect(result.normalized).toBe(result.normalized.toLowerCase());
  });

  it("カタカナと英語表記が同じ canonical トークンに寄る", () => {
    const ja = normalizeBuildingNameDetailed("グランドメゾン日暮里");
    const en = normalizeBuildingNameDetailed("GRAND MAISON NIPPORI");

    expect(ja.tokens).toEqual(["grand", "maison", "nippori"]);
    expect(en.tokens).toEqual(["grand", "maison", "nippori"]);
    expect(ja.canonical).toBe(en.canonical);
  });

  it("グランドコート / GRAND COURT も同じ canonical になる", () => {
    const ja = normalizeBuildingNameDetailed("グランドコート日暮里");
    const en = normalizeBuildingNameDetailed("GRAND COURT NIPPORI");
    expect(ja.canonical).toBe(en.canonical);
  });

  it("ヴ の表記ゆれを吸収する", () => {
    const a = normalizeBuildingNameDetailed("ヴィラ日暮里");
    const b = normalizeBuildingNameDetailed("ビラ日暮里");
    expect(a.canonical).toBe(b.canonical);
  });
});

describe("calculateNameSimilarity", () => {
  it("表記が違っても同一名なら 1.0 になる", () => {
    const result = calculateNameSimilarity("グランドメゾン日暮里", "GRAND MAISON NIPPORI");
    expect(result.score).toBe(1);
    expect(result.transliterationMatch).toBe(true);
  });

  it("サンライズ と SUNRISE を同一名と判定する", () => {
    expect(calculateNameSimilarity("サンライズ", "SUNRISE").score).toBe(1);
  });

  it("辞書に無いカタカナ語もローマ字経由で寄せられる", () => {
    const result = calculateNameSimilarity("メゾンドソレイユ", "MAISON DE SOLEIL");
    expect(result.score).toBeGreaterThan(0.6);
  });

  it("無関係な名前は低スコアになる", () => {
    const result = calculateNameSimilarity("グランドメゾン日暮里", "さくらハイツ町屋");
    expect(result.score).toBeLessThan(0.5);
  });

  it("名前が空なら 0 を返す（誤って一致扱いしない）", () => {
    expect(calculateNameSimilarity("", "GRAND MAISON").score).toBe(0);
    expect(calculateNameSimilarity(null, null).score).toBe(0);
  });
});
