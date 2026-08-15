import { describe, expect, it } from "vitest";
import {
  boundsOf,
  gridSizeForPointCount,
  splitIntoTiles,
  toOverpassBbox,
  type BBox,
} from "../osm/tiles";
import { buildBuildingsQuery } from "../osm/query";

/**
 * 区を区画へ分ける処理の検証。
 *
 * 実測値（台東区: 街区点 3142 / 採用 1214 件 / Overpass 16.5 秒）を前提に、
 * 1 リクエストが 60 秒に収まる粒度へ分けられることを確かめる。
 */

const ARAKAWA: BBox = { south: 35.72, west: 139.75, north: 35.76, east: 139.81 };

describe("区画数の決め方", () => {
  it("街区点が多い区ほど細かく分ける", () => {
    // 実データの街区点数
    const chiyoda = gridSizeForPointCount(1753);
    const arakawa = gridSizeForPointCount(2850);
    const setagaya = gridSizeForPointCount(11963);

    expect(chiyoda).toBeLessThanOrEqual(arakawa);
    expect(arakawa).toBeLessThan(setagaya);
  });

  it("最大でも 4x4 までにする（Overpass への問い合わせを増やしすぎない）", () => {
    expect(gridSizeForPointCount(999_999)).toBe(4);
  });

  it("点が無ければ分割しない", () => {
    expect(gridSizeForPointCount(0)).toBe(1);
  });

  it("どの区でも 1 区画あたりの規模が目安を超えない", () => {
    // 格子は正方形にしか割れないため、区どうしで 1 区画の大きさを
    // そろえることはできない。守るべきなのは「どの区でも 1 区画が
    // 大きくなりすぎない」ことなので、その上限を検証する。
    // 台東区（3142 点）は 1214 件・16.5 秒で取得できたため、
    // 1 区画 1500 点までなら 1 リクエストに十分収まる。
    const wards: Array<[string, number]> = [
      ["千代田区", 1753],
      ["荒川区", 2850],
      ["台東区", 3142],
      ["新宿区", 4832],
      ["板橋区", 6730],
      ["大田区", 8355],
      ["練馬区", 9687],
      ["足立区", 10284],
      ["世田谷区", 11963],
    ];

    for (const [name, points] of wards) {
      const perTile = points / gridSizeForPointCount(points) ** 2;
      expect(perTile, `${name} の 1 区画あたり`).toBeLessThanOrEqual(1500);
    }
  });
});

describe("区画への分割", () => {
  it("side=1 なら分割しない", () => {
    expect(splitIntoTiles(ARAKAWA, 1)).toEqual([ARAKAWA]);
  });

  it("side=2 なら 4 区画になる", () => {
    expect(splitIntoTiles(ARAKAWA, 2)).toHaveLength(4);
  });

  it("区画は元の範囲を覆い、外へはみ出さない", () => {
    const tiles = splitIntoTiles(ARAKAWA, 3);

    // 端の区画は元の範囲と一致する（重なりは内側にだけ付ける）
    expect(Math.min(...tiles.map((t) => t.south))).toBeCloseTo(ARAKAWA.south, 6);
    expect(Math.max(...tiles.map((t) => t.north))).toBeCloseTo(ARAKAWA.north, 6);
    expect(Math.min(...tiles.map((t) => t.west))).toBeCloseTo(ARAKAWA.west, 6);
    expect(Math.max(...tiles.map((t) => t.east))).toBeCloseTo(ARAKAWA.east, 6);
  });

  it("隣り合う区画は重なる（境界の建物を取りこぼさない）", () => {
    const tiles = splitIntoTiles(ARAKAWA, 2);
    const bottomLeft = tiles[0];
    const topLeft = tiles[2];

    // 下の区画の上端が、上の区画の下端より北にある＝重なっている
    expect(bottomLeft.north).toBeGreaterThan(topLeft.south);
  });

  it("分割しても同じ入力なら毎回同じ結果になる（再開できる条件）", () => {
    expect(splitIntoTiles(ARAKAWA, 3)).toEqual(splitIntoTiles(ARAKAWA, 3));
  });
});

describe("座標の集まりから範囲を求める", () => {
  it("最小と最大で囲む", () => {
    expect(
      boundsOf([
        { latitude: 35.73, longitude: 139.78 },
        { latitude: 35.75, longitude: 139.76 },
      ]),
    ).toEqual({ south: 35.73, west: 139.76, north: 35.75, east: 139.78 });
  });

  it("点が無ければ null", () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe("Overpass クエリへの反映", () => {
  const area = { prefecture: "東京都", city: "台東区" };

  it("区画を指定すると範囲で絞り込む", () => {
    const q = buildBuildingsQuery(area, 45, ARAKAWA);

    expect(q).toContain(toOverpassBbox(ARAKAWA));
    // 区の境界による絞り込みは必ず残す（隣の区が混ざらない条件）
    expect(q).toContain("area.ward");
    expect(q).toContain('["admin_level"="7"]["name"="台東区"]');
  });

  it("区画を指定しなければ従来どおり区全体を対象にする", () => {
    const q = buildBuildingsQuery(area, 45);

    expect(q).toContain("area.ward");
    expect(q).not.toMatch(/\(\d+\.\d+,\d+\.\d+,/);
  });

  it("区名は都道府県の内側で特定する（北区・中央区の取り違え防止）", () => {
    const q = buildBuildingsQuery({ prefecture: "東京都", city: "北区" }, 45);

    expect(q).toContain('["admin_level"="4"]["name"="東京都"]');
    expect(q).toContain("rel(area.pref)");
  });
});
