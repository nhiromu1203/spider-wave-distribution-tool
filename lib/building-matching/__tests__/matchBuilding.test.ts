import { describe, expect, it } from "vitest";
import { matchBuilding, type MatchableBuilding } from "../matchBuilding";

const past = (building_name: string, address: string, extra: Partial<MatchableBuilding> = {}) =>
  ({ id: `past-${building_name}`, building_name, address, ...extra }) as MatchableBuilding & {
    id: string;
  };

describe("matchBuilding – 仕様書のテストケース", () => {
  it("【ケース2】住所が完全一致すれば建物名の表記が違っても CONFIRMED_DISTRIBUTED", () => {
    const existing = [past("グランドメゾン日暮里", "東京都荒川区東日暮里1-5-3")];

    const result = matchBuilding(
      { building_name: "GRAND MAISON NIPPORI", address: "荒川区東日暮里1-5-3" },
      existing,
    );

    expect(result.status).toBe("CONFIRMED_DISTRIBUTED");
    expect(result.matched?.id).toBe(existing[0].id);
    expect(result.candidates[0].reasons[0]).toContain("住所完全一致");
  });

  it("【ケース3】住所が部分一致し建物名も高類似なら POSSIBLE_DUPLICATE", () => {
    const existing = [past("グランドコート日暮里", "荒川区東日暮里3-12")];

    const result = matchBuilding(
      { building_name: "GRAND COURT NIPPORI", address: "荒川区東日暮里3-12-5" },
      existing,
    );

    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].reasons.join(" ")).toContain("住所部分一致");
    expect(result.candidates[0].nameSimilarity).toBeGreaterThan(0.9);
  });

  it("【ケース4】建物名だけ類似で住所が明確に違えば NOT_DISTRIBUTED", () => {
    const existing = [past("サンライズ", "荒川区東日暮里1-1-1")];

    const result = matchBuilding(
      { building_name: "SUNRISE", address: "荒川区西日暮里5-5-5" },
      existing,
    );

    expect(result.status).toBe("NOT_DISTRIBUTED");
    expect(result.candidates).toHaveLength(0);
  });
});

describe("matchBuilding – 住所優先ルール", () => {
  it("建物名が全く別でも住所が完全一致すれば配布済み確定にする", () => {
    const existing = [past("第一荒川ハイツ", "荒川区東日暮里1-5-3")];

    const result = matchBuilding(
      { building_name: "ロイヤルパレス東日暮里", address: "東京都荒川区東日暮里1丁目5番3号" },
      existing,
    );

    expect(result.status).toBe("CONFIRMED_DISTRIBUTED");
  });

  it("住所表記だけが違い街区符号が同じなら重複候補にする", () => {
    const existing = [past("グランドメゾン日暮里", "東日暮里1-5-3")];

    const result = matchBuilding(
      { building_name: "グランドメゾン日暮里", address: "荒川区東日暮里1-5-3" },
      existing,
    );

    // 町名の前方に市区町村が付いただけなので normalized_address は不一致だが
    // 同一とみなせる。安全側に倒して候補に上げる。
    expect(result.status).not.toBe("NOT_DISTRIBUTED");
  });

  it("同一町名でも番地が食い違い建物名も違えば未配布", () => {
    const existing = [past("グランドメゾン日暮里", "荒川区東日暮里1-5-3")];

    const result = matchBuilding(
      { building_name: "さくらハイツ", address: "荒川区東日暮里9-9-9" },
      existing,
    );

    expect(result.status).toBe("NOT_DISTRIBUTED");
  });
});

describe("matchBuilding – 緯度経度による補助判定", () => {
  it("座標が無くても正常に動作する", () => {
    const existing = [past("グランドメゾン日暮里", "荒川区東日暮里1-5-3")];
    const result = matchBuilding(
      { building_name: "グランドメゾン日暮里", address: "荒川区東日暮里1-5-3" },
      existing,
    );
    expect(result.status).toBe("CONFIRMED_DISTRIBUTED");
    expect(result.candidates[0].distanceMeters).toBeNull();
  });

  it("住所表記が違っても座標がほぼ同一なら重複候補にする", () => {
    const existing = [
      past("グランドメゾン", "荒川区東日暮里3-12", {
        latitude: 35.7295,
        longitude: 139.7802,
      }),
    ];

    const result = matchBuilding(
      {
        building_name: "GRAND MAISON",
        // 町名が異なるため住所ルールでは候補にならない
        address: "台東区下谷2-1-1",
        latitude: 35.72951,
        longitude: 139.78021,
      },
      existing,
    );

    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.candidates[0].reasons.join(" ")).toContain("座標距離");
  });

  it("座標が離れていれば座標ルールでは候補にしない", () => {
    const existing = [
      past("サンライズ", "荒川区東日暮里1-1-1", { latitude: 35.7295, longitude: 139.7802 }),
    ];

    const result = matchBuilding(
      {
        building_name: "SUNRISE",
        address: "荒川区西日暮里5-5-5",
        latitude: 35.74,
        longitude: 139.79,
      },
      existing,
    );

    expect(result.status).toBe("NOT_DISTRIBUTED");
  });
});

describe("matchBuilding – 安全側への倒し方", () => {
  it("複数の候補がある場合は住所類似度の高い順に並ぶ", () => {
    const existing = [
      past("A", "荒川区東日暮里3-12-9"),
      past("グランドコート日暮里", "荒川区東日暮里3-12"),
    ];

    const result = matchBuilding(
      { building_name: "GRAND COURT NIPPORI", address: "荒川区東日暮里3-12-5" },
      existing,
    );

    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.candidates[0].building.building_name).toBe("グランドコート日暮里");
  });

  it("過去配布データが空なら常に未配布", () => {
    const result = matchBuilding(
      { building_name: "グランドメゾン日暮里", address: "荒川区東日暮里1-5-3" },
      [],
    );
    expect(result.status).toBe("NOT_DISTRIBUTED");
  });

  it("自分自身とは照合しない", () => {
    const self = past("グランドメゾン日暮里", "荒川区東日暮里1-5-3");
    const result = matchBuilding({ ...self }, [self]);
    expect(result.status).toBe("NOT_DISTRIBUTED");
  });
});
