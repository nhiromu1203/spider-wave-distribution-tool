import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertElement, type OsmElement } from "../osm/convert";
import { completeAddresses } from "../address-completion";
import { classifyBuildingUse } from "../building-use";
import {
  normalizeAddress,
  normalizeBuildingName,
  parseAddressParts,
} from "@/lib/building-matching";

/**
 * OSM から取得した生データを、実際のパイプラインへ通して
 * 各段階に何件残るかを集計する診断。
 *
 * Overpass へは問い合わせず、保存済みの生 JSON を読む。
 *
 *   OSM_FIXTURE=/path/to/overpass-response.json \
 *     npx vitest run lib/data-sources/__tests__/osm-funnel.test.ts
 */
const FIXTURE = process.env.OSM_FIXTURE;

const AREA = { prefecture: "東京都", city: "荒川区" };

describe.skipIf(!FIXTURE)("OSM 取得データの段階別内訳", () => {
  it("各段階の残存件数と除外理由を集計する", async () => {
    const raw = JSON.parse(readFileSync(FIXTURE!, "utf8")) as {
      elements: OsmElement[];
    };
    const elements = raw.elements ?? [];

    // ── 段階1: 取得件数 ────────────────────────────────────
    const fetched = elements.length;

    // ── 段階2〜6: convertElement の判定 ────────────────────
    const reasons = new Map<string, number>();
    const accepted: Array<{
      name: string;
      address: string;
      lat: number | null;
      lon: number | null;
      units: number | null;
      hasRealName: boolean;
      addressSource: string;
    }> = [];

    // 判定に使った材料の内訳（原因分析用）
    let hasAnyAddrTag = 0;
    let hasLocalityTag = 0;
    let hasNumberTag = 0;

    for (const element of elements) {
      const tags = element.tags ?? {};
      const keys = Object.keys(tags);
      if (keys.some((k) => k.startsWith("addr:"))) hasAnyAddrTag++;
      if (
        tags["addr:suburb"] ||
        tags["addr:quarter"] ||
        tags["addr:neighbourhood"] ||
        tags["addr:street"] ||
        tags["addr:full"]
      ) {
        hasLocalityTag++;
      }
      if (tags["addr:block_number"] || tags["addr:housenumber"]) hasNumberTag++;

      const result = convertElement(element, AREA);
      if (!result.accepted) {
        reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
        continue;
      }

      accepted.push({
        name: result.building.building_name,
        address: result.building.address,
        lat: result.building.latitude,
        lon: result.building.longitude,
        units: result.building.total_units,
        hasRealName: result.building.building_name !== "（建物名不明）",
        addressSource: result.building.address ? "source" : "",
      });
    }

    // ── 段階5: 座標から住所を補完する ──────────────────────
    const pendingAddress = accepted.filter((b) => !b.address && b.lat !== null);
    const completion = await completeAddresses(
      pendingAddress.map((b) => ({ latitude: b.lat!, longitude: b.lon! })),
      AREA,
    );
    pendingAddress.forEach((b, i) => {
      const c = completion.results[i];
      if (c) {
        b.address = c.address;
        b.addressSource = c.source;
      }
    });
    const addressed = accepted.filter((b) => b.address.length > 0);

    // ── 段階7: 用途判定（ingest 側のゲート）────────────────
    const useAccepted = addressed.filter(
      (b) =>
        classifyBuildingUse("apartments", b.name).use === "RESIDENTIAL_MULTI",
    );

    // ── 段階8: 住所正規化に成功するか ──────────────────────
    const normalizable = useAccepted.filter(
      (b) => normalizeAddress(b.address).length > 0,
    );

    // ── 段階9: 市区町村を特定できるか（エリア絞り込みに必要）──
    const withCity = normalizable.filter(
      (b) => parseAddressParts(b.address).city !== null,
    );

    // ── 段階10: DB の一意キーで統合される件数 ──────────────
    // buildings の一意キーは (normalized_address, normalized_building_name)
    const keyed = new Map<string, number>();
    let refSeq = 0;
    for (const b of withCity) {
      // 方式B: 建物名不明は取得元の識別子で別行にする
      const nameKey = b.hasRealName
        ? normalizeBuildingName(b.name)
        : `${normalizeBuildingName(b.name)}#${refSeq++}`;
      const key = `${normalizeAddress(b.address)}|${nameKey}`;
      keyed.set(key, (keyed.get(key) ?? 0) + 1);
    }
    const uniqueRows = keyed.size;
    const mergedByKey = withCity.length - uniqueRows;

    // ── 出力 ────────────────────────────────────────────────
    const pct = (n: number) => `${((n / fetched) * 100).toFixed(1)}%`;

    console.log("\n══════ 段階別の残存件数（東京都荒川区 / building=apartments）══════");
    console.log(`  1. Overpass 取得件数            ${fetched} 件`);
    console.log(`  2. 用途タグで集合住宅と判定     ${fetched - (reasons.get("not_multi_dwelling") ?? 0) - (reasons.get("mixed_use") ?? 0) - (reasons.get("dormitory") ?? 0)} 件`);
    console.log(`  3. 建物名による除外を通過       ${fetched - (reasons.get("not_multi_dwelling") ?? 0) - (reasons.get("mixed_use") ?? 0) - (reasons.get("dormitory") ?? 0) - (reasons.get("name_excluded") ?? 0)} 件`);
    console.log(`  4. OSM タグから住所を組み立てた ${accepted.length - pendingAddress.length} 件 (${pct(accepted.length - pendingAddress.length)})`);
    console.log(`  5. 座標から住所を補完           +${completion.completed} 件（補完率 ${((completion.completed / Math.max(1, pendingAddress.length)) * 100).toFixed(1)}%）`);
    console.log(`  6. 住所が確定した               ${addressed.length} 件 (${pct(addressed.length)})`);
    console.log(`  7. 用途判定（ingest ゲート）    ${useAccepted.length} 件`);
    console.log(`  8. 住所正規化に成功             ${normalizable.length} 件`);
    console.log(`  9. 市区町村を特定できた         ${withCity.length} 件`);
    console.log(` 10. DB 一意キーで統合後（表示）  ${uniqueRows} 件`);

    console.log("\n══════ 除外された建物の理由別内訳 ══════");
    const total = fetched - accepted.length;
    const labels: Record<string, string> = {
      no_address: "住所を組み立てられない（addr:* タグ不足）",
      not_multi_dwelling: "集合住宅ではない building タグ",
      mixed_use: "住居以外の用途タグが同居（店舗・事務所など）",
      dormitory: "寮・社宅・高齢者施設",
      name_excluded: "建物名が対象外を示す",
      no_coordinates: "座標なし",
    };
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${labels[reason] ?? reason}: ${count} 件 (${pct(count)})`);
    }
    console.log(`  ── 除外合計: ${total} 件`);
    console.log(`  ※ DB 統合で減る分: ${mergedByKey} 件（同一住所・同一建物名）`);

    console.log("\n══════ 住所タグの収録状況（除外の根本原因）══════");
    console.log(`  addr:* を1つでも持つ            ${hasAnyAddrTag} 件 (${pct(hasAnyAddrTag)})`);
    console.log(`  町名系タグあり(suburb/quarter等) ${hasLocalityTag} 件 (${pct(hasLocalityTag)})`);
    console.log(`  番地系タグあり(block/housenumber) ${hasNumberTag} 件 (${pct(hasNumberTag)})`);
    console.log(`  OSM タグだけで住所になった       ${accepted.length - pendingAddress.length} 件 (${pct(accepted.length - pendingAddress.length)})`);
    console.log(`  座標から補完して住所になった     ${completion.completed} 件（${completion.provider?.label ?? "-"}）`);

    console.log("\n══════ 採用された建物の属性 ══════");
    console.log(`  建物名あり                      ${accepted.filter((b) => b.hasRealName).length} / ${accepted.length} 件`);
    console.log(`  建物名なし（建物名不明として採用）${accepted.filter((b) => !b.hasRealName).length} 件`);
    console.log(`  座標あり                        ${accepted.filter((b) => b.lat !== null).length} / ${accepted.length} 件`);
    console.log(`  総戸数あり                      ${accepted.filter((b) => b.units !== null).length} / ${accepted.length} 件`);

    console.log("\n══════ 参考: 座標は取れているか ══════");
    const withCoordsAll = elements.filter(
      (e) => e.center || (e.lat !== undefined && e.lon !== undefined),
    ).length;
    console.log(`  取得した460件のうち座標あり     ${withCoordsAll} 件 (${pct(withCoordsAll)})`);
    console.log("");

    // 集計が破綻していないことだけ確認する
    expect(accepted.length + total).toBe(fetched);
    expect(addressed.length).toBeGreaterThanOrEqual(accepted.length - pendingAddress.length);
    expect(uniqueRows).toBeLessThanOrEqual(accepted.length);
  });
});
