import { describe, expect, it } from "vitest";
import {
  classifyBuildingUse,
  classifyOsmBuildingTag,
  OSM_AMBIGUOUS,
  OSM_RESIDENTIAL_MULTI,
} from "../building-use";

const use = (value: string | null, name?: string) =>
  classifyBuildingUse(value, name).use;

describe("配布対象は集合住宅のみ", () => {
  it("OSM で配布対象になるのは apartments と housing だけ", () => {
    expect([...OSM_RESIDENTIAL_MULTI].sort()).toEqual(["apartments", "housing"]);
  });

  it("apartments / housing は配布対象", () => {
    expect(use("apartments")).toBe("RESIDENTIAL_MULTI");
    expect(use("housing")).toBe("RESIDENTIAL_MULTI");
  });

  it("大文字・前後の空白があっても判定できる", () => {
    expect(use("  APARTMENTS ")).toBe("RESIDENTIAL_MULTI");
  });

  it("日本語のマンション・アパート・集合住宅は配布対象", () => {
    for (const value of [
      "マンション",
      "アパート",
      "集合住宅",
      "共同住宅",
      "分譲マンション",
      "賃貸アパート",
      "コーポ",
      "ハイツ",
      "メゾン",
      "レジデンス",
      "団地",
      "都営住宅",
    ]) {
      expect(use(value), value).toBe("RESIDENTIAL_MULTI");
    }
  });
});

describe("集合住宅以外はすべて対象外", () => {
  it("寮・社宅は対象外", () => {
    for (const value of ["dormitory", "寮", "社宅", "官舎", "学生寮"]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("戸建て・一軒家は対象外", () => {
    for (const value of [
      "house",
      "detached",
      "semidetached_house",
      "bungalow",
      "戸建て",
      "一戸建",
      "一軒家",
    ]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("長屋・テラスハウスは対象外", () => {
    for (const value of ["terrace", "長屋", "テラスハウス", "タウンハウス"]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("店舗・店舗付き住宅は対象外", () => {
    for (const value of [
      "commercial",
      "retail",
      "shop",
      "supermarket",
      "hotel",
      "店舗",
      "商業施設",
      "店舗付き住宅",
      "店舗併用住宅",
    ]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("店舗付きマンションも対象外（住居専用ではないため）", () => {
    expect(use("店舗付きマンション")).toBe("EXCLUDED");
    expect(use("店舗併用マンション")).toBe("EXCLUDED");
  });

  it("オフィス・事務所は対象外", () => {
    for (const value of ["office", "government", "civic", "オフィス", "事務所"]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("工場・倉庫は対象外", () => {
    for (const value of ["industrial", "warehouse", "factory", "工場", "倉庫"]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("学校・病院は対象外", () => {
    for (const value of [
      "school",
      "university",
      "kindergarten",
      "hospital",
      "clinic",
      "学校",
      "病院",
      "クリニック",
    ]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });

  it("ガレージ・駐車場は対象外", () => {
    for (const value of [
      "garage",
      "garages",
      "parking",
      "shed",
      "ガレージ",
      "駐車場",
      "車庫",
    ]) {
      expect(use(value), value).toBe("EXCLUDED");
    }
  });
});

describe("用途を判定できない建物も対象外", () => {
  it("building=residential / yes などは対象外", () => {
    for (const tag of OSM_AMBIGUOUS) {
      const judged = classifyBuildingUse(tag);
      expect(judged.use, tag).toBe("EXCLUDED");
      expect(judged.excludedAsUnknown, tag).toBe(true);
    }
  });

  it("未知のタグは対象外", () => {
    const judged = classifyBuildingUse("something_unknown");
    expect(judged.use).toBe("EXCLUDED");
    expect(judged.excludedAsUnknown).toBe(true);
    expect(classifyOsmBuildingTag("something_unknown")).toBeNull();
  });

  it("用途も建物名も手掛かりが無ければ対象外", () => {
    for (const [value, name] of [
      [null, undefined],
      ["", ""],
      ["   ", "さくら"],
      [null, "山田ビル"],
    ] as Array<[string | null, string | undefined]>) {
      const judged = classifyBuildingUse(value, name);
      expect(judged.use).toBe("EXCLUDED");
      expect(judged.excludedAsUnknown).toBe(true);
    }
  });

  it("用途不明による除外は他の除外と区別できる", () => {
    // 件数表示で「用途不明で何件落ちたか」を示すために使う
    expect(classifyBuildingUse("warehouse").excludedAsUnknown).toBe(false);
    expect(classifyBuildingUse("yes").excludedAsUnknown).toBe(true);
  });
});

describe("用途の値が無い場合は建物名から判断する", () => {
  it("建物名が集合住宅を示せば配布対象にする", () => {
    // 標準の CSV には用途列が無いことが多く、この経路が実質の主判定になる
    expect(use(null, "サンライトマンション荒川")).toBe("RESIDENTIAL_MULTI");
    expect(use(null, "コーポ町屋")).toBe("RESIDENTIAL_MULTI");
    expect(use(null, "町屋グリーンハイツ")).toBe("RESIDENTIAL_MULTI");
    expect(use(null, "荒川メゾンひぐらし")).toBe("RESIDENTIAL_MULTI");
  });

  it("建物名が対象外を示せば対象外にする", () => {
    expect(use(null, "鈴木店舗")).toBe("EXCLUDED");
    expect(use(null, "東京第一工場")).toBe("EXCLUDED");
    expect(use(null, "荒川第一社宅")).toBe("EXCLUDED");
  });

  it("種別（賃貸・分譲）だけでは集合住宅と判断しない", () => {
    // 戸建ての賃貸・分譲もあるため
    expect(use("賃貸", "さくら")).toBe("EXCLUDED");
    expect(use("分譲", "さくら")).toBe("EXCLUDED");
  });
});

describe("判定理由", () => {
  it("OSM タグで判定した場合はタグ名を残す", () => {
    const judged = classifyBuildingUse("apartments");
    expect(judged.reason).toContain("building=apartments");
    expect(judged.category).toBe("residential_multi");
  });

  it("除外理由が分かる文言になっている", () => {
    expect(classifyBuildingUse("warehouse").reason).toContain("対象外");
    expect(classifyBuildingUse("dormitory").reason).toContain("寮・社宅");
    expect(classifyBuildingUse("terrace").reason).toContain("戸建て・長屋");
  });

  it("用途不明で除外した理由が分かる", () => {
    expect(classifyBuildingUse("residential").reason).toContain("特定できず");
    expect(classifyBuildingUse(null).reason).toContain("判定できない");
  });
});
