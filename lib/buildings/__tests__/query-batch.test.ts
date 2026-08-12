import { describe, expect, it } from "vitest";
import {
  chunkForInFilter,
  filterBytes,
  MAX_FILTER_BYTES,
  MAX_FILTER_VALUES,
} from "../query-batch";

/**
 * HeadersOverflowError（UND_ERR_HEADERS_OVERFLOW）の再発防止。
 *
 * 実際に起きた失敗:
 *   normalized_address を 200 件まとめて in.() に渡した結果、
 *   URL が 12,898 文字になり undici のヘッダー上限を超えた。
 *
 * 上限は URL 単体ではなく apikey・Authorization の JWT を含む
 * ヘッダー全体に効くため、URL だけを見て安全と判断してはいけない。
 */

const TOWNS = ["西尾久", "東尾久", "町屋", "荒川", "南千住", "東日暮里", "西日暮里"];

/** 荒川区で実際に生成される形の正規化住所 */
function makeAddresses(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `荒川区${TOWNS[i % TOWNS.length]}${(i % 8) + 1}-${(i % 60) + 1}`,
  );
}

/** OSM の取得元 ID */
function makeSourceRefs(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `osm:way/${100000000 + i}`);
}

describe("問題の再現", () => {
  it("200件をまとめると実際に失敗した規模のURLになる", () => {
    const addresses = makeAddresses(200);
    // 実際の失敗時と同じ桁（12,898文字）に達する
    expect(filterBytes(addresses)).toBeGreaterThan(10_000);
  });
});

describe("分割後は安全な大きさに収まる", () => {
  it("荒川区の実件数（253住所）でも各バッチが上限以内", () => {
    const batches = chunkForInFilter(makeAddresses(253));

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(filterBytes(batch)).toBeLessThanOrEqual(MAX_FILTER_BYTES);
      expect(batch.length).toBeLessThanOrEqual(MAX_FILTER_VALUES);
    }
  });

  it("1バッチは20〜30件程度になる", () => {
    const batches = chunkForInFilter(makeAddresses(253));
    // 最後のバッチは端数なので除いて確認する
    for (const batch of batches.slice(0, -1)) {
      expect(batch.length).toBeGreaterThanOrEqual(15);
      expect(batch.length).toBeLessThanOrEqual(MAX_FILTER_VALUES);
    }
  });

  it("23区規模（10,000件）でも全バッチが上限以内", () => {
    const batches = chunkForInFilter(makeAddresses(10_000));

    for (const batch of batches) {
      expect(filterBytes(batch)).toBeLessThanOrEqual(MAX_FILTER_BYTES);
    }
    // 分割しても値は 1 件も失われない
    expect(batches.flat()).toHaveLength(10_000);
  });

  it("取得元IDでも上限以内に収まる", () => {
    for (const batch of chunkForInFilter(makeSourceRefs(500))) {
      expect(filterBytes(batch)).toBeLessThanOrEqual(MAX_FILTER_BYTES);
    }
  });

  it("UUID の一括更新でも上限以内に収まる", () => {
    const ids = Array.from(
      { length: 300 },
      (_, i) => `b6de8716-957f-435a-b076-a1a17d88${String(i).padStart(4, "0")}`,
    );
    for (const batch of chunkForInFilter(ids)) {
      expect(filterBytes(batch)).toBeLessThanOrEqual(MAX_FILTER_BYTES);
    }
  });
});

describe("値を取りこぼさない", () => {
  it("分割しても順序と件数が保たれる", () => {
    const addresses = makeAddresses(457);
    expect(chunkForInFilter(addresses).flat()).toEqual(addresses);
  });

  it("空配列ならバッチも空", () => {
    expect(chunkForInFilter([])).toEqual([]);
  });

  it("1件だけなら1バッチ", () => {
    expect(chunkForInFilter(["荒川区東日暮里1-5-3"])).toEqual([
      ["荒川区東日暮里1-5-3"],
    ]);
  });

  it("単独で上限を超える値も捨てずに残す（照合漏れを防ぐため）", () => {
    const huge = "あ".repeat(500);
    const batches = chunkForInFilter([huge, "荒川区町屋1-1-1"]);

    expect(batches.flat()).toContain(huge);
    expect(batches.flat()).toHaveLength(2);
    // 巨大な値は単独のバッチになる
    expect(batches[0]).toEqual([huge]);
  });
});

describe("上限値の妥当性", () => {
  it("ヘッダー全体の上限に対して十分な余裕がある", () => {
    // undici の既定は 16KB。JWT やその他ヘッダー分を差し引いても余る大きさにする
    expect(MAX_FILTER_BYTES).toBeLessThanOrEqual(2_000);
  });
});
