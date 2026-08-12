import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPathAllowed,
  parseRobotsTxt,
  parseListPage,
  scrapingBuildingDataSource,
  validateSiteConfig,
  isBlockedHost,
  DEFAULT_POLITENESS,
  TEMPLATE_SITE_CONFIG,
  SCRAPING_SITES,
  type ScrapingSiteConfig,
} from "../scraping";
import { looksLikeCaptcha } from "../scraping/http";
import { parseTownIndex } from "../scraping/parse-html";
import { expandCoverage } from "../scraping/types";

/** 検証用の設定。ネットワークには一切出ない。 */
function makeConfig(overrides: Partial<ScrapingSiteConfig> = {}): ScrapingSiteConfig {
  return {
    ...TEMPLATE_SITE_CONFIG,
    id: "test-site",
    baseUrl: "https://opendata.example.jp",
    compliance: {
      termsUrl: "https://opendata.example.jp/terms",
      termsReviewedAt: "2026-08-11",
      robotsCheckedAt: "2026-08-11",
      allowsAutomatedAccess: true,
      basis: "利用規約 第5条で自動取得が明示的に許可されている",
    },
    politeness: DEFAULT_POLITENESS,
    ...overrides,
  };
}

const LIST_HTML = `
<html><body>
  <ul class="building-list">
    <li>
      <span class="building-name">グランドメゾン日暮里</span>
      <span class="address">東京都荒川区東日暮里1-5-3</span>
      <span class="type">賃貸</span>
      <span class="units">全24戸</span>
      <meta itemprop="latitude" content="35.7295">
      <meta itemprop="longitude" content="139.7802">
      <a class="detail-link" href="/buildings/1">詳細</a>
    </li>
    <li>
      <span class="building-name">コーポ町屋</span>
      <span class="address">荒川区町屋1-3-7</span>
      <a class="detail-link" href="/buildings/2">詳細</a>
    </li>
    <li>
      <span class="building-name">住所が無い建物</span>
    </li>
  </ul>
</body></html>`;

describe("HTML → SourceBuilding 変換", () => {
  const config = makeConfig();
  const pageUrl = new URL("https://opendata.example.jp/buildings/tokyo/arakawa");

  it("セレクタ設定に従って共通型へ変換する", () => {
    const { buildings } = parseListPage(LIST_HTML, config, pageUrl);
    const first = buildings[0];

    expect(first.building_name).toBe("グランドメゾン日暮里");
    expect(first.address).toBe("東京都荒川区東日暮里1-5-3");
    expect(first.property_type).toBe("rental");
    expect(first.total_units).toBe(24);
    expect(first.latitude).toBeCloseTo(35.7295);
    expect(first.longitude).toBeCloseTo(139.7802);
    expect(first.source_ref).toBe(
      "test-site:https://opendata.example.jp/buildings/1",
    );
  });

  it("住所から都道府県・市区町村・町名を補完する", () => {
    const { buildings } = parseListPage(LIST_HTML, config, pageUrl);

    expect(buildings[0].prefecture).toBe("東京都");
    expect(buildings[0].city).toBe("荒川区");
    expect(buildings[0].town).toBe("東日暮里");

    // 都道府県が省略された住所でも市区町村・町名は取れる
    expect(buildings[1].city).toBe("荒川区");
    expect(buildings[1].town).toBe("町屋");
  });

  it("取得できない項目は推測せず null にする", () => {
    const { buildings } = parseListPage(LIST_HTML, config, pageUrl);
    const second = buildings[1];

    expect(second.total_units).toBeNull();
    expect(second.latitude).toBeNull();
    expect(second.longitude).toBeNull();
    expect(second.property_type).toBe("unknown");
  });

  it("住所が取れない行は捨てる（配布済み判定ができなくなるため）", () => {
    const { buildings, itemCount } = parseListPage(LIST_HTML, config, pageUrl);
    expect(itemCount).toBe(3);
    expect(buildings).toHaveLength(2);
    expect(buildings.some((b) => b.building_name === "住所が無い建物")).toBe(false);
  });

  it("セレクタが一致しなければ 0 件になる（例外を投げない）", () => {
    const wrong = makeConfig({ itemSelector: ".does-not-exist" });
    const { buildings, itemCount } = parseListPage(LIST_HTML, wrong, pageUrl);
    expect(itemCount).toBe(0);
    expect(buildings).toEqual([]);
  });
});

describe("robots.txt の解析と判定", () => {
  const robots = parseRobotsTxt(`
    User-agent: *
    Disallow: /private/
    Crawl-delay: 5

    User-agent: BadBot
    Disallow: /
  `);

  it("Disallow のパスを拒否する", () => {
    const d = isPathAllowed(robots, "SpiderWaveDistributionTool/1.0", "/private/list");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("robots.txt");
  });

  it("許可されたパスは通す", () => {
    expect(isPathAllowed(robots, "SpiderWaveDistributionTool/1.0", "/buildings/x").allowed).toBe(
      true,
    );
  });

  it("Crawl-delay を秒→ミリ秒で読み取る", () => {
    expect(isPathAllowed(robots, "SpiderWaveDistributionTool/1.0", "/buildings").crawlDelayMs).toBe(
      5000,
    );
  });

  it("自分に名指しのグループがあればそちらを優先する", () => {
    const d = isPathAllowed(robots, "BadBot/2.0", "/buildings");
    expect(d.allowed).toBe(false);
  });

  it("Allow が Disallow より長く一致すれば許可する", () => {
    const groups = parseRobotsTxt(`
      User-agent: *
      Disallow: /data/
      Allow: /data/public/
    `);
    expect(isPathAllowed(groups, "any", "/data/public/list").allowed).toBe(true);
    expect(isPathAllowed(groups, "any", "/data/private/list").allowed).toBe(false);
  });

  it("空の Disallow は制限なしとして扱う", () => {
    const groups = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(isPathAllowed(groups, "any", "/anything").allowed).toBe(true);
  });

  it("末尾 $ のパターンを正しく扱う", () => {
    const groups = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$");
    expect(isPathAllowed(groups, "any", "/docs/a.pdf").allowed).toBe(false);
    expect(isPathAllowed(groups, "any", "/docs/a.pdf.html").allowed).toBe(true);
  });
});

describe("接続してよい取得先かの検査", () => {
  it("利用規約で自動取得が禁止されているホストは拒否する", () => {
    for (const host of ["suumo.jp", "www.homes.co.jp", "realestate.yahoo.co.jp"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
    expect(isBlockedHost("opendata.example.jp")).toBe(false);
  });

  it("禁止ホストは設定に書かれていても使用できない", () => {
    const config = makeConfig({ baseUrl: "https://suumo.jp" });
    const result = validateSiteConfig(config);

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toContain("禁止");
  });

  it("自動取得の許可が未確認なら使用できない", () => {
    const config = makeConfig({
      compliance: { ...makeConfig().compliance, allowsAutomatedAccess: false },
    });
    const result = validateSiteConfig(config);

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toContain("許可が確認されていません");
  });

  it("確認日が未記入なら使用できない", () => {
    const config = makeConfig({
      compliance: { ...makeConfig().compliance, robotsCheckedAt: null },
    });
    expect(validateSiteConfig(config).available).toBe(false);
  });

  it("住所セレクタが無ければ使用できない", () => {
    const config = makeConfig({ fields: { building_name: { selector: ".n" } } });
    const result = validateSiteConfig(config);

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toContain("住所");
  });

  it("すべて満たした設定は使用できる", () => {
    expect(validateSiteConfig(makeConfig()).available).toBe(true);
  });
});

describe("取得先未設定のときの振る舞い", () => {
  const saved = process.env.SCRAPING_SITE_ID;
  beforeEach(() => {
    delete process.env.SCRAPING_SITE_ID;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SCRAPING_SITE_ID;
    else process.env.SCRAPING_SITE_ID = saved;
  });

  it("SCRAPING_SITES は空（取得先未設定）", () => {
    expect(SCRAPING_SITES).toEqual([]);
  });

  it("利用不可として理由を返す", () => {
    const availability = scrapingBuildingDataSource.isAvailable();
    expect(availability.available).toBe(false);
    if (!availability.available) {
      expect(availability.reason).toContain("取得先が未設定");
    }
  });

  it("対応エリアは空", () => {
    expect(scrapingBuildingDataSource.listAreas()).toEqual([]);
  });

  it("ネットワークへ出ずに例外を投げる", async () => {
    await expect(
      scrapingBuildingDataSource.fetchByArea({ prefecture: "東京都", city: "荒川区" }),
    ).rejects.toThrow(/未設定/);
  });

  it("見本設定は許可未確認のままで、そのままでは使えない", () => {
    expect(TEMPLATE_SITE_CONFIG.compliance.allowsAutomatedAccess).toBe(false);
    expect(validateSiteConfig(TEMPLATE_SITE_CONFIG).available).toBe(false);
  });
});

describe("区を引数として扱う共通実装", () => {
  it("listPath に特定の区を埋め込まない設計になっている", () => {
    // 見本設定はプレースホルダのみで、区名がハードコードされていない
    expect(TEMPLATE_SITE_CONFIG.listPath).not.toMatch(/[^{]区/);
    expect(TEMPLATE_SITE_CONFIG.listPath).toContain("{city");
  });

  it("都道府県指定の対応範囲は23区へ展開される", () => {
    const config = makeConfig({
      coverage: { mode: "prefectures", prefectures: ["東京都"] },
    });
    const areas = expandCoverage(config.coverage);

    expect(areas).toHaveLength(23);
    expect(areas.map((a) => a.city)).toContain("世田谷区");
  });

  it("町丁目の索引ページから町名を取り出せる", () => {
    const html = `
      <ul class="town-list">
        <li><a href="/t/1">東日暮里（120件）</a></li>
        <li><a href="/t/2">西日暮里 (98件)</a></li>
        <li><a href="/t/3">町屋</a></li>
        <li><a href="/t/4"></a></li>
      </ul>`;
    const towns = parseTownIndex(html, "ul.town-list > li a");

    expect(towns).toHaveLength(3);
    expect(towns).toContain("東日暮里");
    expect(towns).toContain("西日暮里");
    expect(towns).toContain("町屋");
  });
});

describe("アクセス制限の検知", () => {
  it("CAPTCHA / bot 検知ページを見分ける", () => {
    expect(looksLikeCaptcha("<html><body>Please solve the reCAPTCHA</body></html>")).toBe(
      true,
    );
    expect(looksLikeCaptcha("<html><body>ロボットではありませんか？</body></html>")).toBe(
      true,
    );
    expect(looksLikeCaptcha(LIST_HTML)).toBe(false);
  });

  it("既定のアクセス間隔は控えめ（3秒以上）", () => {
    expect(DEFAULT_POLITENESS.minIntervalMs).toBeGreaterThanOrEqual(3000);
    expect(DEFAULT_POLITENESS.maxRetries).toBeLessThanOrEqual(3);
  });
});
