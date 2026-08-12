import { describe, expect, it } from "vitest";
import {
  AREA_MASTER,
  getCity,
  getCityCode,
  getPrefecture,
  getPrefectureCode,
  isKnownArea,
  listCities,
  listPrefectures,
  TOKYO_23_WARD_NAMES,
} from "../areas";
import { expandCoverage } from "../scraping/types";

describe("行政区域マスタ", () => {
  it("東京都を対応都道府県として持つ", () => {
    expect(listPrefectures()).toContain("東京都");
    expect(getPrefectureCode("東京都")).toBe("13");
  });

  it("東京都23区をすべて返す", () => {
    const cities = listCities("東京都");
    expect(cities).toHaveLength(23);

    // 代表的な区が漏れていないこと
    for (const ward of ["千代田区", "荒川区", "世田谷区", "江戸川区", "北区"]) {
      expect(cities).toContain(ward);
    }
    expect(TOKYO_23_WARD_NAMES).toHaveLength(23);
  });

  it("区名が重複していない", () => {
    const cities = listCities("東京都");
    expect(new Set(cities).size).toBe(cities.length);
  });

  it("全国地方公共団体コードを引ける", () => {
    expect(getCityCode("東京都", "千代田区")).toBe("13101");
    expect(getCityCode("東京都", "荒川区")).toBe("13118");
    expect(getCityCode("東京都", "江戸川区")).toBe("13123");
  });

  it("23区のコードが 13101〜13123 で連番かつ一意", () => {
    const codes = getPrefecture("東京都")!.cities.map((c) => c.code);
    expect(new Set(codes).size).toBe(23);
    expect(codes[0]).toBe("13101");
    expect(codes[22]).toBe("13123");
  });

  it("すべての区に読みが登録されている", () => {
    for (const city of getPrefecture("東京都")!.cities) {
      expect(city.kana.length).toBeGreaterThan(0);
      expect(city.kana).toMatch(/^[ぁ-ん]+$/);
    }
  });

  it("未対応の都道府県は空を返す（例外を投げない）", () => {
    expect(listCities("大阪府")).toEqual([]);
    expect(getPrefecture("存在しない県")).toBeNull();
    expect(getCity("東京都", "存在しない区")).toBeNull();
    expect(getCityCode("大阪府", "北区")).toBeNull();
  });

  it("マスタに存在するエリアかを判定できる", () => {
    expect(isKnownArea("東京都", "荒川区")).toBe(true);
    expect(isKnownArea("東京都", "横浜市")).toBe(false);
    expect(isKnownArea(null, "荒川区")).toBe(false);
  });

  it("都道府県を追加できる構造になっている（配列に足すだけ）", () => {
    expect(Array.isArray(AREA_MASTER)).toBe(true);
    for (const prefecture of AREA_MASTER) {
      expect(prefecture.name).toBeTruthy();
      expect(prefecture.code).toMatch(/^\d{2}$/);
      expect(Array.isArray(prefecture.cities)).toBe(true);
    }
  });
});

describe("取得元の対応範囲の展開", () => {
  it("都道府県指定なら23区すべてに展開される（特定区に固定されない）", () => {
    const areas = expandCoverage({ mode: "prefectures", prefectures: ["東京都"] });

    expect(areas).toHaveLength(23);
    expect(areas.every((a) => a.prefecture === "東京都")).toBe(true);
    expect(areas.map((a) => a.city)).toContain("練馬区");
    expect(areas.map((a) => a.city)).toContain("荒川区");
  });

  it("市区町村を明示した場合はそれだけに絞られる", () => {
    const areas = expandCoverage({
      mode: "cities",
      cities: [
        { prefecture: "東京都", city: "荒川区" },
        { prefecture: "東京都", city: "台東区" },
      ],
    });

    expect(areas).toHaveLength(2);
    expect(areas.map((a) => a.city)).toEqual(["荒川区", "台東区"]);
  });

  it("未対応の都道府県を指定しても例外にならない", () => {
    expect(expandCoverage({ mode: "prefectures", prefectures: ["大阪府"] })).toEqual([]);
  });
});
