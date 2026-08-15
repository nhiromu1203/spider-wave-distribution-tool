import { describe, expect, it } from "vitest";
import { blockKeyOf, parseBlockKey, toHalfWidth } from "../block-key";
import { parseListPage } from "../providers/homes-archive";

describe("表記ゆれを吸収する", () => {
  it("全角英数字とハイフンを半角へ寄せる", () => {
    expect(toHalfWidth("３－１２－５")).toBe("3-12-5");
    expect(toHalfWidth("東日暮里 ３ー１２")).toBe("東日暮里3-12");
  });
});

describe("住所から街区を取り出す", () => {
  it("漢数字の丁目に対応する", () => {
    expect(parseBlockKey("東京都荒川区東日暮里三丁目12")).toEqual({
      town: "東日暮里",
      chome: 3,
      block: 12,
    });
  });

  it("算用数字の丁目に対応する", () => {
    expect(parseBlockKey("荒川区東日暮里3丁目12-5")).toEqual({
      town: "東日暮里",
      chome: 3,
      block: 12,
    });
  });

  it("ハイフン区切りに対応する", () => {
    expect(parseBlockKey("東京都荒川区東日暮里3-12-5")).toEqual({
      town: "東日暮里",
      chome: 3,
      block: 12,
    });
  });

  it("号の有無にかかわらず同じ街区になる", () => {
    // こちらの住所には号が無く、候補側には号がある。
    // 街区まで一致すれば同じ組で照合する。
    expect(blockKeyOf("東京都荒川区東日暮里三丁目12")).toBe(
      blockKeyOf("荒川区東日暮里3丁目12-5"),
    );
  });

  it("番が違えば別の街区になる（絶対に混ぜない）", () => {
    expect(blockKeyOf("荒川区東日暮里3-12")).not.toBe(
      blockKeyOf("荒川区東日暮里3-13"),
    );
  });

  it("丁目が違えば別の街区になる", () => {
    expect(blockKeyOf("荒川区東日暮里3-12")).not.toBe(
      blockKeyOf("荒川区東日暮里4-12"),
    );
  });

  it("町名が違えば別の街区になる", () => {
    expect(blockKeyOf("荒川区東日暮里6-42")).not.toBe(
      blockKeyOf("荒川区西日暮里6-42"),
    );
  });

  it("番が読み取れない住所は null", () => {
    expect(parseBlockKey("東京都荒川区東日暮里")).toBeNull();
    expect(blockKeyOf("")).toBeNull();
  });
});

describe("一覧ページの読み取り", () => {
  // 実ページの構造をそのまま縮めたもの
  const html = `
<div><a href="https://www.homes.co.jp/archive/b-27774669/" target="_blank">
  <h2><span class="font-bold">アイオス日暮里</span>
  <span>マンション</span></h2>
  <p><span><img src="map_gray.png"></span>
    荒川区東日暮里4丁目32-10
  </p></a></div>
<div><a href="https://www.homes.co.jp/archive/b-27774670/" target="_blank">
  <h2><span class="font-bold">佐竹ビル</span></h2>
  <p>荒川区東日暮里4丁目32-2</p></a></div>
<div><a href="https://www.homes.co.jp/archive/b-27774671/" target="_blank">
  <h2><span class="font-bold">住所が読めない建物</span></h2>
  <p>荒川区東日暮里</p></a></div>`;

  it("建物名と所在地の対を取り出す", () => {
    const rows = parseListPage(html);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "アイオス日暮里",
      address: "荒川区東日暮里4丁目32-10",
      source: "homes_archive",
    });
    expect(rows[1].name).toBe("佐竹ビル");
  });

  it("街区を取り出せない行は捨てる（照合に使えないため）", () => {
    expect(parseListPage(html).map((r) => r.name)).not.toContain(
      "住所が読めない建物",
    );
  });

  it("建物リンクが無ければ空", () => {
    expect(parseListPage("<html><body>該当なし</body></html>")).toEqual([]);
  });
});
