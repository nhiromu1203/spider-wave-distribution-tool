import { describe, expect, it } from "vitest";
import { completeAddresses } from "../address-completion";
import { cacheKey, fetchOverpass, queryTimeoutSeconds } from "../osm/client";
import { convertElements } from "../osm/convert";
import { buildBuildingsQuery } from "../osm/query";

/**
 * 区ごとの取得にかかる時間と件数を実測する。
 *
 * Vercel Hobby では 1 リクエストが 60 秒で打ち切られるため、
 * 「どの処理にどれだけかかるのか」「1 リクエストに収まるのか」を
 * 推測ではなく実測で判断するために使う。
 *
 * 公開 API に負荷をかけないよう、既定では実行しない:
 *   OSM_INTEGRATION=1 OSM_WARD=台東区 npx vitest run lib/data-sources/__tests__/osm-ward-timing.test.ts
 *
 * 1 回の実行で Overpass へのリクエストは 1 回だけ。
 */
const ENABLED = process.env.OSM_INTEGRATION === "1";
const WARD = process.env.OSM_WARD || "台東区";
const PREFECTURE = "東京都";

describe.skipIf(!ENABLED)(`${WARD}の取得時間を実測する`, () => {
  it(
    "取得・変換・住所補完それぞれの所要時間を測る",
    async () => {
      const area = { prefecture: PREFECTURE, city: WARD };

      const t0 = Date.now();
      const fetched = await fetchOverpass(
        buildBuildingsQuery(area, queryTimeoutSeconds()),
        cacheKey(PREFECTURE, WARD),
      );
      const overpassMs = Date.now() - t0;

      const t1 = Date.now();
      const { buildings, stats } = convertElements(fetched.elements, area);
      const convertMs = Date.now() - t1;

      const pending = buildings.filter((b) => !b.address && b.latitude !== null);
      const t2 = Date.now();
      const completion = await completeAddresses(
        pending.map((b) => ({
          latitude: b.latitude as number,
          longitude: b.longitude as number,
        })),
        area,
      );
      const completionMs = Date.now() - t2;

      const withAddress =
        buildings.filter((b) => b.address.length > 0).length + completion.completed;

      console.log(`\n=== ${WARD} 実測 ===`);
      console.log(`OSM 要素数        : ${fetched.elements.length}`);
      console.log(`集合住宅として採用: ${stats.accepted}`);
      console.log(`住所補完の対象    : ${pending.length}`);
      console.log(`住所が確定        : ${withAddress}`);
      console.log(`--- 所要時間 ---`);
      console.log(`Overpass 問い合わせ: ${overpassMs} ms`);
      console.log(`変換・用途判定     : ${convertMs} ms`);
      console.log(`住所補完           : ${completionMs} ms`);
      console.log(`合計（DB 登録前）  : ${overpassMs + convertMs + completionMs} ms`);

      expect(fetched.elements.length).toBeGreaterThan(0);
    },
    240_000,
  );
});
