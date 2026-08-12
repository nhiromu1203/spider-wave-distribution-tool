import { describe, expect, it } from "vitest";
import { osmBuildingDataSource } from "../osm";
import { classifyBuildingUse } from "../building-use";
import { normalizeAddress } from "@/lib/building-matching";

/**
 * Overpass API へ実際に接続する結合テスト。
 *
 * 公開 API に負荷をかけないよう、既定では実行しない。
 * 実行するときだけ環境変数を付ける:
 *
 *   OSM_INTEGRATION=1 npx vitest run lib/data-sources/__tests__/osm-integration.test.ts
 *
 * 取得は荒川区 1 区のみ。1 回の実行で 1 リクエストしか出さない。
 */
const ENABLED = process.env.OSM_INTEGRATION === "1";

describe.skipIf(!ENABLED)("Overpass API から荒川区の集合住宅を取得する", () => {
  it(
    "実データを取得して SourceBuilding へ変換できる",
    async () => {
      const result = await osmBuildingDataSource.fetchByArea({
        prefecture: "東京都",
        city: "荒川区",
      });

      const buildings = result.buildings;

      // ── 取得結果の内訳を出力する（報告用）──────────────────
      const withName = buildings.filter(
        (b) => b.building_name !== "（建物名不明）",
      ).length;
      const withUnits = buildings.filter((b) => b.total_units !== null).length;
      const withCoords = buildings.filter((b) => b.latitude !== null).length;
      const normalizable = buildings.filter(
        (b) => normalizeAddress(b.address).length > 0,
      ).length;

      console.log("\n=== 荒川区 実データ取得結果 ===");
      for (const note of result.notes ?? []) console.log(" -", note);
      console.log(` - 住所を正規化できた: ${normalizable} 件`);
      console.log("\n=== 採用された建物のサンプル（先頭10件）===");
      for (const b of buildings.slice(0, 10)) {
        console.log(
          `  ${b.building_name} | ${b.address} | 戸数=${b.total_units ?? "不明"} | ${b.latitude?.toFixed(5) ?? "-"},${b.longitude?.toFixed(5) ?? "-"}`,
        );
      }
      console.log(
        `\n件数: 採用 ${buildings.length} / 建物名あり ${withName} / 座標あり ${withCoords} / 総戸数あり ${withUnits}`,
      );
      console.log("\n=== 正規化後の住所（先頭10件）===");
      for (const b of buildings.slice(0, 10)) {
        console.log(`  ${b.address}  →  ${normalizeAddress(b.address)}`);
      }

      // ── 実データが取れていること ──────────────────────────
      // 日本の OSM は建物ポリゴンに addr:* が付いていないことが多く、
      // 荒川区では building=apartments 460 件のうち住所を持つのは約 12 件。
      // 件数の少なさは実装ではなく OSM 側のデータ収録状況による。
      expect(buildings.length).toBeGreaterThanOrEqual(10);

      // ── すべて集合住宅と判定されること ────────────────────
      for (const b of buildings) {
        const judged = classifyBuildingUse(b.building_use_raw, b.building_name);
        expect(judged.use, `${b.building_name} が集合住宅と判定されない`).toBe(
          "RESIDENTIAL_MULTI",
        );
      }

      // ── 住所は必ずあり、正規化できること ──────────────────
      for (const b of buildings) {
        expect(b.address.length).toBeGreaterThan(0);
        expect(normalizeAddress(b.address).length).toBeGreaterThan(0);
      }

      // ── 荒川区のデータであること ──────────────────────────
      const inWard = buildings.filter((b) => b.address.includes("荒川区"));
      expect(inWard.length).toBe(buildings.length);

      // ── 総戸数は取れなければ null（推定値を入れない）──────
      for (const b of buildings) {
        expect(b.total_units === null || b.total_units > 0).toBe(true);
      }

      // ── 出典表記があること（ODbL）─────────────────────────
      expect((result.notes ?? []).join(" ")).toContain("OpenStreetMap");
    },
    300_000,
  );

  it("2 回目はキャッシュから返し、Overpass へ問い合わせない", async () => {
    const started = Date.now();
    const result = await osmBuildingDataSource.fetchByArea({
      prefecture: "東京都",
      city: "荒川区",
    });

    // キャッシュヒットならネットワーク往復が無いので即座に返る
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.buildings.length).toBeGreaterThan(0);
  }, 300_000);
});

describe("Overpass へ接続しない検証", () => {
  it("東京都23区すべてを対応エリアとして返す", () => {
    const areas = osmBuildingDataSource.listAreas();
    expect(areas).toHaveLength(23);
    expect(areas.every((a) => a.prefecture === "東京都")).toBe(true);
    expect(areas.map((a) => a.city)).toContain("荒川区");
    expect(areas.map((a) => a.city)).toContain("世田谷区");
  });

  it("対応外のエリアはネットワークへ出る前に断る", async () => {
    expect(
      osmBuildingDataSource.supportsArea?.({ prefecture: "大阪府", city: "北区" }),
    ).toBe(false);

    await expect(
      osmBuildingDataSource.fetchByArea({ prefecture: "大阪府", city: "北区" }),
    ).rejects.toThrow(/対応していません/);
  });

  it("取得元として常に利用可能（接続先の設定が不要）", () => {
    expect(osmBuildingDataSource.isAvailable().available).toBe(true);
    expect(osmBuildingDataSource.isDevelopment).toBe(false);
  });
});
