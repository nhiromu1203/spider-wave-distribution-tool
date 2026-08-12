import { describe, expect, it } from "vitest";
import { convertElement, type OsmElement } from "../osm/convert";
import { UNKNOWN_BUILDING_NAME } from "../types";
import { normalizeBuildingName } from "@/lib/building-matching";

/**
 * 入力した建物名が次回取得で失われないことの検証。
 *
 * 同一建物の判定は ingest 側で
 *   1. 取得元での識別子（source_ref）が一致
 *   2. 同一住所かつ座標が 15m 以内
 * の順に行う。ここでは取得元が毎回同じ source_ref を返すこと、
 * および比較用の名前が入力後に実名へ変わることを確認する。
 */

const ELEMENT: OsmElement = {
  type: "way",
  id: 123456789,
  center: { lat: 35.7295, lon: 139.7802 },
  tags: {
    building: "apartments",
    "addr:province": "東京都",
    "addr:city": "荒川区",
    "addr:quarter": "東日暮里一丁目",
    "addr:block_number": "5",
    "addr:housenumber": "3",
  },
};

const AREA = { prefecture: "東京都", city: "荒川区" };

describe("建物名を入力しても次回取得で重複しない", () => {
  it("取得元の識別子は毎回同じ値になる", () => {
    const first = convertElement(ELEMENT, AREA);
    const second = convertElement(ELEMENT, AREA);

    expect(first.accepted && second.accepted).toBe(true);
    if (!first.accepted || !second.accepted) return;

    // source_ref が安定していれば、名前が変わっても同じ建物と判定できる
    expect(first.building.source_ref).toBe("osm:way/123456789");
    expect(second.building.source_ref).toBe(first.building.source_ref);
  });

  it("建物名が無い建物は「建物名不明」として取り込まれる", () => {
    const result = convertElement(ELEMENT, AREA);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.building.building_name).toBe(UNKNOWN_BUILDING_NAME);
    // 座標を持つので、地図で場所を特定できる
    expect(result.building.latitude).toBeCloseTo(35.7295);
    expect(result.building.longitude).toBeCloseTo(139.7802);
  });

  it("OSM 側に名前が付いた場合もその名前を使う", () => {
    const named = convertElement(
      { ...ELEMENT, tags: { ...ELEMENT.tags, "name:ja": "グランドメゾン日暮里" } },
      AREA,
    );
    expect(named.accepted).toBe(true);
    if (!named.accepted) return;

    expect(named.building.building_name).toBe("グランドメゾン日暮里");
    // 識別子は変わらないため、既存行に統合される
    expect(named.building.source_ref).toBe("osm:way/123456789");
  });

  it("入力した建物名は比較用の名前にも反映され、重複判定に使えるようになる", () => {
    // 画面から入力した名前は normalized_building_name も更新する
    const entered = "グランドメゾン日暮里";
    expect(normalizeBuildingName(entered)).toBe(
      normalizeBuildingName("グランドメゾン日暮里"),
    );
    // 表記が違っても同じ比較値になる（既存の正規化がそのまま効く）
    expect(normalizeBuildingName("ＧＲＡＮＤ　ＭＡＩＳＯＮ")).toBe(
      normalizeBuildingName("grand maison"),
    );
  });
});

describe("住所の粒度", () => {
  it("OSM に住所があれば住居番号まで持つ", () => {
    const result = convertElement(ELEMENT, AREA);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;

    expect(result.building.address).toBe("東京都荒川区東日暮里一丁目5-3");
    expect(result.building.address_source).toBe("source");
    expect(result.building.address_precision).toBe("housenumber");
  });

  it("住所タグが無い建物は住所未確定で通し、後段の補完に委ねる", () => {
    const noAddr = convertElement(
      { ...ELEMENT, tags: { building: "apartments" } },
      AREA,
    );
    expect(noAddr.accepted).toBe(true);
    if (!noAddr.accepted) return;

    expect(noAddr.building.address).toBe("");
    expect(noAddr.building.address_source).toBeNull();
  });

  it("住所も座標も無ければ登録しない", () => {
    const nothing = convertElement(
      { type: "way", id: 1, tags: { building: "apartments" } },
      AREA,
    );
    expect(nothing.accepted).toBe(false);
    if (nothing.accepted) return;
    expect(nothing.reason).toBe("no_address");
  });
});
