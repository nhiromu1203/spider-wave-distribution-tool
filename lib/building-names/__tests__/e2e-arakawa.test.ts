import { describe, expect, it } from "vitest";
import { osmBuildingDataSource } from "@/lib/data-sources/osm";
import { UNKNOWN_BUILDING_NAME } from "@/lib/data-sources/types";
import { blockKeyOf } from "../block-key";
import { geocodeAddress } from "../geocode";
import { matchBuildingNames, type NameCandidate } from "../match";
import {
  discoverChomeLinks,
  fetchChomeCandidates,
  getLastFetchFailure,
} from "../providers/homes-archive";

/**
 * 建物名補完を、実データで最後まで通す。
 *
 *   OSM_INTEGRATION=1 npx vitest run lib/building-names/__tests__/e2e-arakawa.test.ts
 *
 * Supabase への読み書き以外は本番と同じ経路を通る
 * （索引の解析・一覧の解析・ジオコーディング・判定）。
 * 公開サイトへ問い合わせるため、既定では実行しない。
 */
const ENABLED = process.env.OSM_INTEGRATION === "1";
const WARD = "荒川区";
const SLUG = "arakawa-city";

describe.skipIf(!ENABLED)("荒川区で建物名補完を最後まで実行する", () => {
  it(
    "索引の解析から判定まで通る",
    async () => {
      // ── 1. 建物名が分からない建物を集める ──────────────────
      const fetched = await osmBuildingDataSource.fetchByArea({
        prefecture: "東京都",
        city: WARD,
        chunkIndex: 0,
      });

      const targets = fetched.buildings.filter(
        (b) =>
          b.latitude !== null &&
          (!b.building_name ||
            b.building_name === UNKNOWN_BUILDING_NAME ||
            b.building_name.trim() === ""),
      );

      const byBlock = new Map<string, typeof targets>();
      for (const b of targets) {
        const key = blockKeyOf(b.address);
        if (!key) continue;
        byBlock.set(key, [...(byBlock.get(key) ?? []), b]);
      }
      console.log(`\n対象 ${targets.length} 件 / ${byBlock.size} 街区`);

      // ── 2. 丁目の一覧ページを特定する ──────────────────────
      const links = await discoverChomeLinks(SLUG);
      console.log(`索引から丁目ページ ${links.length} 件を検出`);

      if (links.length === 0) {
        // 2026-08-15 時点、HOME'S は自ら名乗る User-Agent に 403 を返す。
        // ブラウザを装えば通るが、アクセス制限の回避にあたるため行わない。
        console.log(`取得できなかった理由: ${getLastFetchFailure()}`);
        expect(getLastFetchFailure()).toContain("403");
        return;
      }

      const wanted = new Set(
        [...byBlock.keys()].map((k) => k.split("/").slice(0, 2).join("/")),
      );
      const targetLinks = links.filter((l) => wanted.has(`${l.town}/${l.chome}`));
      console.log(`必要な丁目 ${wanted.size} → 該当ページ ${targetLinks.length} 件`);
      expect(targetLinks.length).toBeGreaterThan(0);

      // ── 3. 候補を集める ────────────────────────────────────
      const candidatesByBlock = new Map<string, NameCandidate[]>();
      let rawCount = 0;

      for (const link of targetLinks) {
        const raw = await fetchChomeCandidates(link.url, 2);
        rawCount += raw.length;
        for (const c of raw) {
          const key = blockKeyOf(c.address);
          if (!key || !byBlock.has(key)) continue;
          candidatesByBlock.set(key, [
            ...(candidatesByBlock.get(key) ?? []),
            { ...c, latitude: 0, longitude: 0 },
          ]);
        }
      }
      console.log(
        `一覧から ${rawCount} 件を解析、対象街区に該当 ${[...candidatesByBlock.values()].flat().length} 件`,
      );
      expect(rawCount).toBeGreaterThan(0);

      // ── 4. 候補を座標に変換する ────────────────────────────
      for (const [key, list] of candidatesByBlock) {
        const located: NameCandidate[] = [];
        for (const c of list) {
          const point = await geocodeAddress(
            c.address.startsWith("東京都") ? c.address : `東京都${c.address}`,
          );
          if (point) located.push({ ...c, ...point });
        }
        candidatesByBlock.set(key, located);
      }

      // ── 5. 判定する ────────────────────────────────────────
      const counts = { HIGH: 0, AMBIGUOUS: 0, NOT_FOUND: 0 };
      const samples: string[] = [];

      for (const [key, buildings] of byBlock) {
        const results = matchBuildingNames(
          buildings.map((b) => ({
            id: b.source_ref ?? b.address,
            latitude: b.latitude as number,
            longitude: b.longitude as number,
          })),
          candidatesByBlock.get(key) ?? [],
        );

        for (const [i, r] of results.entries()) {
          counts[r.verdict]++;
          if (r.verdict === "HIGH" && samples.length < 20) {
            samples.push(
              `${buildings[i].address}\t→ ${r.name}\t(${r.candidate?.address}, ${r.distanceMeters?.toFixed(0)}m)`,
            );
          }
        }
      }

      const total = counts.HIGH + counts.AMBIGUOUS + counts.NOT_FOUND;
      console.log(`\n=== 判定結果（n=${total}）===`);
      console.log(`HIGH      : ${counts.HIGH} 件 (${((counts.HIGH / total) * 100).toFixed(1)}%)`);
      console.log(`AMBIGUOUS : ${counts.AMBIGUOUS} 件 (${((counts.AMBIGUOUS / total) * 100).toFixed(1)}%)`);
      console.log(`NOT_FOUND : ${counts.NOT_FOUND} 件 (${((counts.NOT_FOUND / total) * 100).toFixed(1)}%)`);
      console.log(`\n=== 自動で付いた建物名（最大20件）===`);
      samples.forEach((s, i) => console.log(`${String(i + 1).padStart(2)} ${s}`));

      expect(total).toBeGreaterThan(0);
    },
    1_800_000,
  );
});
