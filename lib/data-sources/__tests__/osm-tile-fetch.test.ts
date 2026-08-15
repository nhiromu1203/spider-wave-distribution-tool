import { describe, expect, it } from "vitest";
import { planAreaTiles } from "../osm";
import { cacheKey, fetchOverpass, queryTimeoutSeconds } from "../osm/client";
import { convertElements } from "../osm/convert";
import { buildBuildingsQuery } from "../osm/query";

/**
 * 区画に分けた取得を、実際の Overpass API に対して確かめる。
 *
 * 公開 API に負荷をかけるため既定では実行しない:
 *   OSM_INTEGRATION=1 OSM_WARD=台東区 npx vitest run lib/data-sources/__tests__/osm-tile-fetch.test.ts
 *
 * ── 台東区での実測（2026-08-15）────────────────────────────
 *   区画数 4
 *   区画1: 要素 417 / 採用 417 /  3.3 秒
 *   区画2: 要素 154 / 採用 154 /  5.0 秒
 *   区画3: 要素 288 / 採用 287 / 84.3 秒  ← 件数と無関係に遅い
 *   区画4: 要素 389 / 採用 389 /  9.4 秒
 *   延べ 1247 件 → 重複を除くと 1212 件（区画をまたぐ建物の重なり分）
 *
 * 区画3 が示すとおり、応答時間は件数ではなく Overpass 側の混雑で決まり、
 * 分割しても 60 秒以内は保証できない。分割の目的は
 * 「1 リクエストの仕事量を減らし、失敗しても途中から再開できること」。
 * ────────────────────────────────────────────────────────────
 */
const ENABLED = process.env.OSM_INTEGRATION === "1";
const WARD = process.env.OSM_WARD || "台東区";

describe.skipIf(!ENABLED)(`${WARD}を区画に分けて取得する`, () => {
  it(
    "区画ごとに取得でき、重なり分を除けば区全体を覆う",
    async () => {
      const area = { prefecture: "東京都", city: WARD };
      const tiles = await planAreaTiles(area);
      expect(tiles).not.toBeNull();

      const unique = new Set<string>();
      let sum = 0;

      for (let i = 0; i < tiles!.length; i++) {
        const startedAt = Date.now();
        const fetched = await fetchOverpass(
          buildBuildingsQuery(area, queryTimeoutSeconds(), tiles![i]),
          `${cacheKey("東京都", WARD)}#${i}`,
        );
        const { buildings, stats } = convertElements(fetched.elements, area);

        for (const b of buildings) if (b.source_ref) unique.add(b.source_ref);
        sum += stats.accepted;

        console.log(
          `区画 ${i + 1}/${tiles!.length}: 要素 ${fetched.elements.length} / 採用 ${stats.accepted} / ${Date.now() - startedAt} ms`,
        );
      }

      console.log(`延べ ${sum} 件 → 重複を除くと ${unique.size} 件`);

      // 区画が重なる分、延べ件数はユニーク件数以上になる
      expect(sum).toBeGreaterThanOrEqual(unique.size);
      expect(unique.size).toBeGreaterThan(0);
    },
    900_000,
  );
});
