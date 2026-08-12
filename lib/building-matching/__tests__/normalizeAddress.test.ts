import { describe, expect, it } from "vitest";
import {
  normalizeAddress,
  normalizeAddressDetailed,
  parseAddressParts,
} from "../normalizeAddress";

describe("normalizeAddress", () => {
  it("【ケース1】丁目・番・号 表記と ハイフン表記 を同一住所として扱う", () => {
    const a = normalizeAddress("東京都荒川区東日暮里1丁目5番3号");
    const b = normalizeAddress("荒川区東日暮里1-5-3");

    expect(a).toBe("荒川区東日暮里1-5-3");
    expect(a).toBe(b);
  });

  it("都道府県の有無・全角・空白の違いをすべて吸収する", () => {
    const variants = [
      "東京都荒川区東日暮里1丁目5番3号",
      "東京都荒川区東日暮里1-5-3",
      "荒川区東日暮里１－５－３",
      "荒川区 東日暮里 1-5-3",
      "荒川区東日暮里一丁目五番三号",
      "東京都　荒川区　東日暮里１丁目５番３号",
    ];

    const normalized = variants.map(normalizeAddress);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("荒川区東日暮里1-5-3");
  });

  it("末尾に混入した建物名を住所本体から切り離す（原本は呼び出し側が保持）", () => {
    const result = normalizeAddressDetailed("荒川区東日暮里1-5-3 グランドメゾン日暮里 101号室");

    expect(result.normalized).toBe("荒川区東日暮里1-5-3");
    expect(result.extra).toContain("メゾン");
    expect(result.blocks).toEqual([1, 5, 3]);
  });

  it("札幌のような条・丁目形式でも住所の一部を切り落とさない", () => {
    const result = normalizeAddressDetailed("北海道札幌市北区北12条西4丁目1");

    expect(result.extra).toBe("");
    expect(result.normalized).toContain("12");
    expect(result.normalized).toContain("4");
  });

  it("空文字・null を安全に扱う", () => {
    expect(normalizeAddress(null)).toBe("");
    expect(normalizeAddress(undefined)).toBe("");
    expect(normalizeAddress("   ")).toBe("");
  });

  it("東日暮里と西日暮里は別の町として区別される", () => {
    expect(normalizeAddress("荒川区東日暮里1-1-1")).not.toBe(
      normalizeAddress("荒川区西日暮里1-1-1"),
    );
  });
});

describe("parseAddressParts", () => {
  it("都道府県・市区町村・町名に分解する", () => {
    expect(parseAddressParts("東京都荒川区東日暮里1-5-3")).toEqual({
      prefecture: "東京都",
      city: "荒川区",
      town: "東日暮里",
    });
  });

  it("郡を含む住所は町村までを市区町村として扱う", () => {
    const parts = parseAddressParts("北海道虻田郡倶知安町北1条東1-1");
    expect(parts.prefecture).toBe("北海道");
    expect(parts.city).toBe("虻田郡倶知安町");
  });

  it("都道府県が省略されていても市区町村を取得できる", () => {
    const parts = parseAddressParts("荒川区東日暮里1-5-3");
    expect(parts.prefecture).toBeNull();
    expect(parts.city).toBe("荒川区");
    expect(parts.town).toBe("東日暮里");
  });
});
