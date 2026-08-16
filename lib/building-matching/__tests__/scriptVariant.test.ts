import { describe, expect, it } from "vitest";
import { detectScript, isScriptVariant } from "../scriptVariant";

/**
 * 文字種違いの判定。
 *
 * ── なぜ類似度で判定しないか（実測値）────────────────────────
 *   グランドメゾン中野 / GRAND MAISON NAKANO   0.854  ← 同じ建物
 *   グランドメゾン中野 / グランドメゾン新宿     0.950  ← 別の建物
 *   コスモステージ… S棟 / … N棟               0.947  ← 別の建物
 *   ノーザンスクエア / サザンスクエア           0.818  ← 別の建物
 *
 * 同じ建物より別の建物のほうが高く出るため、しきい値では切り分けられない。
 * 「文字種が違うこと」を必須条件にしている。
 */

describe("文字種の判定", () => {
  it("英字だけ・日本語だけ・混在を見分ける", () => {
    expect(detectScript("GRAND MAISON NAKANO")).toBe("latin");
    expect(detectScript("グランドメゾン中野")).toBe("japanese");
    expect(detectScript("グランドメゾン NAKANO")).toBe("mixed");
    expect(detectScript("123-456")).toBe("empty");
  });

  it("全角英字も英字として扱う", () => {
    expect(detectScript("ＧＲＡＮＤ")).toBe("latin");
  });
});

describe("表記違いとみなすもの", () => {
  it("日本語表記と英語表記", () => {
    expect(isScriptVariant("グランドメゾン中野", "GRAND MAISON NAKANO")).toBe(true);
    expect(isScriptVariant("パークハウス東中野", "PARK HOUSE HIGASHINAKANO")).toBe(true);
  });

  it("順序を入れ替えても同じ結果", () => {
    expect(isScriptVariant("GRAND MAISON NAKANO", "グランドメゾン中野")).toBe(true);
  });
});

describe("表記違いとみなさないもの", () => {
  it("同じ文字種どうしは、どれだけ似ていても別の建物", () => {
    // 実測 0.950。しきい値だけなら通ってしまう組み合わせ
    expect(isScriptVariant("グランドメゾン中野", "グランドメゾン新宿")).toBe(false);
    // 実測 0.947
    expect(isScriptVariant("コスモステージ荒川遊園 S棟", "コスモステージ荒川遊園 N棟")).toBe(false);
    // 実測 0.818
    expect(isScriptVariant("ノーザンスクエア", "サザンスクエア")).toBe(false);
  });

  it("部分一致は表記違いではない", () => {
    expect(isScriptVariant("メゾン丸十", "メゾン丸十第二")).toBe(false);
  });

  it("文字種が違っても似ていなければ別の建物", () => {
    expect(isScriptVariant("メゾン丸十", "PARK HOUSE HIGASHINAKANO")).toBe(false);
  });

  it("空文字は判定しない", () => {
    expect(isScriptVariant("", "GRAND MAISON")).toBe(false);
    expect(isScriptVariant("グランドメゾン", "")).toBe(false);
    expect(isScriptVariant("123", "456")).toBe(false);
  });
});
