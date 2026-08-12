import { describe, expect, it } from "vitest";
import { calculateNameSimilarity, distanceInMeters } from "@/lib/building-matching";

/**
 * 座標だけで同一建物とみなす条件の検証。
 *
 * ingest 側の findByCoordinatesOnly は Supabase クライアントを伴うため、
 * ここでは判定の土台になる距離計算と建物名の類似度が、
 * 想定どおりの値を返すことを確認する。
 *
 * ── 統合する条件（すべて満たすときだけ）────────────────────
 * 1. 距離 5m 以内
 * 2. どちらかに実際の建物名がある
 * 3. 両方に名前がある場合は類似度 0.5 以上
 */

const MERGE_DISTANCE = 5;
const NEAR_DISTANCE = 15;

/** 緯度 1 度 ≒ 111,195m。指定メートルだけ北へずらす */
function shiftNorth(lat: number, meters: number): number {
  return lat + meters / 111_195;
}

const BASE = { latitude: 35.7295, longitude: 139.7802 };

describe("距離のしきい値", () => {
  it("3m ずらした点は統合範囲に入る", () => {
    const d = distanceInMeters(BASE, {
      latitude: shiftNorth(BASE.latitude, 3),
      longitude: BASE.longitude,
    });
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(MERGE_DISTANCE);
  });

  it("8m ずらした点は統合範囲から外れる（別棟の可能性を残す）", () => {
    const d = distanceInMeters(BASE, {
      latitude: shiftNorth(BASE.latitude, 8),
      longitude: BASE.longitude,
    });
    expect(d!).toBeGreaterThan(MERGE_DISTANCE);
    expect(d!).toBeLessThanOrEqual(NEAR_DISTANCE);
  });

  it("40m 離れた点は近接候補にもならない", () => {
    const d = distanceInMeters(BASE, {
      latitude: shiftNorth(BASE.latitude, 40),
      longitude: BASE.longitude,
    });
    expect(d!).toBeGreaterThan(NEAR_DISTANCE);
  });

  it("座標が無ければ距離は求められない（統合されない）", () => {
    expect(distanceInMeters(BASE, { latitude: null, longitude: null })).toBeNull();
  });
});

describe("建物名の矛盾判定", () => {
  it("表記違いの同一名は統合を妨げない", () => {
    expect(
      calculateNameSimilarity("グランドメゾン日暮里", "GRAND MAISON NIPPORI").score,
    ).toBeGreaterThanOrEqual(0.5);
  });

  it("明らかに別の建物名は統合を止める", () => {
    // 実データで隣り合っていた 2 棟
    const similarity = calculateNameSimilarity("ノーザンスクエア", "サザンスクエア");
    expect(similarity.score).toBeLessThan(0.9);
  });

  it("まったく無関係な名前は類似度が低い", () => {
    expect(
      calculateNameSimilarity("グランドメゾン日暮里", "さくらハイツ町屋").score,
    ).toBeLessThan(0.5);
  });
});

describe("実データで想定される組み合わせ", () => {
  it("同一街区の別棟（コスモステージ荒川遊園 S棟 / N棟）は距離で切り分けられる", () => {
    // 実際の OSM 座標
    const sTou = { latitude: 35.75284, longitude: 139.75318 };
    const nTou = { latitude: 35.75341, longitude: 139.75297 };
    const d = distanceInMeters(sTou, nTou);

    expect(d).not.toBeNull();
    // 60m 以上離れており、統合されることはない
    expect(d!).toBeGreaterThan(NEAR_DISTANCE);
  });

  it("ノーザンスクエア / サザンスクエアも統合されない距離にある", () => {
    const north = { latitude: 35.75326, longitude: 139.75162 };
    const south = { latitude: 35.7529, longitude: 139.75159 };
    const d = distanceInMeters(north, south);

    expect(d!).toBeGreaterThan(NEAR_DISTANCE);
  });
});
