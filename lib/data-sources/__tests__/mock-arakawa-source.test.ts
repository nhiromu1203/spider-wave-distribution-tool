import { describe, expect, it } from "vitest";
import { mockBuildingDataSource } from "../mock-arakawa-source";
import { isDevelopmentData } from "../types";
import { matchBuilding, type MatchableBuilding } from "@/lib/building-matching";

/** samples/過去配布済みリスト_サンプル.csv と同じ内容 */
const PAST_DISTRIBUTED: MatchableBuilding[] = [
  { id: "p1", building_name: "グランドメゾン日暮里", address: "東京都荒川区東日暮里1丁目5番3号" },
  { id: "p2", building_name: "グランドコート日暮里", address: "荒川区東日暮里3-12" },
  { id: "p3", building_name: "サンライズ", address: "荒川区東日暮里1-1-1" },
  { id: "p4", building_name: "第一荒川ハイツ", address: "東京都荒川区町屋2-8-1" },
  { id: "p5", building_name: "ロイヤルパレス三ノ輪", address: "荒川区東日暮里6-60-1" },
];

async function fetchArakawa(town?: string) {
  return mockBuildingDataSource.fetchByArea({
    prefecture: "東京都",
    city: "荒川区",
    town: town ?? null,
  });
}

describe("mockBuildingDataSource", () => {
  it("開発確認用データとして明示されている", () => {
    expect(mockBuildingDataSource.isDevelopment).toBe(true);
    expect(mockBuildingDataSource.isAvailable().available).toBe(true);
  });

  it("source_ref から開発用データだと判別できる", async () => {
    const { buildings } = await fetchArakawa();
    expect(buildings.length).toBeGreaterThan(0);
    for (const b of buildings) {
      expect(isDevelopmentData(b.source_ref)).toBe(true);
    }
  });

  it("総世帯数は自動取得しないため、すべて null（＝不明）", async () => {
    const { buildings } = await fetchArakawa();
    for (const b of buildings) {
      expect(b.total_units).toBeNull();
    }
  });

  it("町名を指定するとその町だけに絞られる", async () => {
    const all = await fetchArakawa();
    const machiya = await fetchArakawa("町屋");

    expect(machiya.buildings.length).toBeGreaterThan(0);
    expect(machiya.buildings.length).toBeLessThan(all.buildings.length);
    for (const b of machiya.buildings) {
      expect(b.address).toContain("町屋");
    }
  });

  it("町名を指定しない場合は市区町村全体が対象になる", async () => {
    const { buildings } = await fetchArakawa();
    const towns = new Set(buildings.map((b) => b.address));
    expect(towns.size).toBe(buildings.length);
    expect(buildings.length).toBeGreaterThan(10);
  });

  it("対応エリアとして東京都荒川区を返す", () => {
    const areas = mockBuildingDataSource.listAreas();
    expect(areas).toHaveLength(1);
    expect(areas[0].prefecture).toBe("東京都");
    expect(areas[0].city).toBe("荒川区");
    expect(areas[0].towns).toContain("東日暮里");
  });

  it("対応外のエリアを指定すると空を返す", async () => {
    const result = await mockBuildingDataSource.fetchByArea({
      prefecture: "東京都",
      city: "台東区",
    });
    expect(result.buildings).toEqual([]);
  });
});

describe("モックデータと過去配布リストの照合", () => {
  const judge = async (name: string) => {
    const { buildings } = await fetchArakawa();
    const target = buildings.find((b) => b.building_name === name);
    expect(target, `${name} がモックデータに存在しない`).toBeDefined();
    return matchBuilding(
      { building_name: target!.building_name, address: target!.address },
      PAST_DISTRIBUTED,
    );
  };

  it("住所完全一致（表記違い）→ 配布済み確定として一覧から除外される", async () => {
    const result = await judge("GRAND MAISON NIPPORI");
    expect(result.status).toBe("CONFIRMED_DISTRIBUTED");
    expect(result.matched?.id).toBe("p1");
  });

  it("丁目/番/号 表記の住所一致も配布済み確定になる", async () => {
    const result = await judge("ロイヤルパレス三ノ輪");
    expect(result.status).toBe("CONFIRMED_DISTRIBUTED");
    expect(result.matched?.id).toBe("p5");
  });

  it("住所前方一致＋建物名高類似 → 重複候補として隔離される", async () => {
    const result = await judge("GRAND COURT NIPPORI");
    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.candidates[0].building.id).toBe("p2");
  });

  it("建物名だけ一致し町名が違う → 配布対象のまま残る", async () => {
    const result = await judge("SUNRISE");
    expect(result.status).toBe("NOT_DISTRIBUTED");
  });

  it("過去配布リストと無関係な建物は配布対象として残る", async () => {
    for (const name of ["コーポ町屋", "サンハイム南千住", "パークホームズ荒川"]) {
      const result = await judge(name);
      expect(result.status, `${name} が配布対象にならない`).toBe("NOT_DISTRIBUTED");
    }
  });
});
