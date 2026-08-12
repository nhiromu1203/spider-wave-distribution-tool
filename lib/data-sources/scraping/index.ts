/**
 * ── ScrapingBuildingDataSource ─────────────────────────────
 *
 * HTML の一覧ページから建物情報を取得する取得元。
 * 対象 URL・CSS セレクタ・ページネーション方式はすべて設定値（sites.ts）で、
 * 取得元を差し替えてもこのファイルは変更しない。
 *
 * ── 動かすための条件（すべて満たす必要がある）──────────────
 * 1. SCRAPING_SITES に設定が登録されている
 * 2. その設定の compliance.allowsAutomatedAccess が true
 *    （利用規約と robots.txt を人が確認し、日付を記録していること）
 * 3. 取得先ホストが BLOCKED_HOSTS に該当しない
 * 4. 実行時に robots.txt を取得し、対象パスが Disallow でない
 *
 * ── 実装しないこと ──────────────────────────────────────────
 * ・プロキシローテーション
 * ・CAPTCHA の回避
 * ・User-Agent の偽装によるアクセス制限の回避
 * 403 / 429 / CAPTCHA / robots.txt 拒否を受けたら、回避せず取得を停止する。
 * ────────────────────────────────────────────────────────────
 */

import type {
  AreaQuery,
  BuildingDataSource,
  DataSourceAvailability,
  FetchResult,
  SourceBuilding,
  SupportedArea,
} from "../types";
import { getCityCode, getPrefectureCode, isKnownArea } from "../areas";
import { PoliteFetcher, ScrapingStoppedError } from "./http";
import { parseListPage, parseTownIndex } from "./parse-html";
import { fetchRobotsTxt, isPathAllowed } from "./robots";
import { getSelectedScrapingSite, SCRAPING_SITES } from "./sites";
import { expandCoverage, isBlockedHost, type ScrapingSiteConfig } from "./types";

export const SCRAPING_SOURCE_ID = "scraping";

/** 設定が取得に使える状態かを検査する。理由はそのまま画面に出せる日本語で返す。 */
export function validateSiteConfig(
  config: ScrapingSiteConfig,
): DataSourceAvailability {
  let hostname: string;
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return {
      available: false,
      reason: `取得先の baseUrl が URL として解釈できません（${config.baseUrl}）。`,
    };
  }

  if (isBlockedHost(hostname)) {
    return {
      available: false,
      reason: `${hostname} は利用規約で自動取得が禁止されているため、取得元として使用できません。`,
    };
  }

  const { compliance } = config;
  if (!compliance.allowsAutomatedAccess) {
    return {
      available: false,
      reason:
        `${config.label} は自動取得の許可が確認されていません。` +
        "利用規約と robots.txt を確認し、sites.ts の compliance.allowsAutomatedAccess を true にしてください。",
    };
  }
  if (!compliance.termsReviewedAt || !compliance.robotsCheckedAt) {
    return {
      available: false,
      reason:
        `${config.label} は確認記録が未記入です。` +
        "compliance.termsReviewedAt と compliance.robotsCheckedAt に確認日を記録してください。",
    };
  }

  if (!config.itemSelector?.trim()) {
    return { available: false, reason: "itemSelector が未設定です。" };
  }
  if (!config.fields.address?.selector?.trim()) {
    return {
      available: false,
      reason:
        "住所のセレクタが未設定です。住所は配布済み判定の最優先キーのため必須です。",
    };
  }

  return { available: true };
}

/**
 * パスのプレースホルダを実際のエリアで置換する。
 * 区は引数として渡されるため、特定の区が埋め込まれることはない。
 */
function fillAreaPlaceholders(
  path: string,
  area: { prefecture: string; city: string; town?: string | null },
): string {
  const prefectureCode = getPrefectureCode(area.prefecture) ?? "";
  const cityCode = getCityCode(area.prefecture, area.city) ?? "";

  return path
    .replaceAll("{prefectureCode}", encodeURIComponent(prefectureCode))
    .replaceAll("{cityCode}", encodeURIComponent(cityCode))
    .replaceAll("{prefecture}", encodeURIComponent(area.prefecture))
    .replaceAll("{city}", encodeURIComponent(area.city))
    .replaceAll("{town}", encodeURIComponent(area.town ?? ""));
}

/** エリアを listPath に埋め込んでページ URL を作る */
function buildListUrl(
  config: ScrapingSiteConfig,
  area: AreaQuery,
  page: number,
): URL {
  const url = new URL(fillAreaPlaceholders(config.listPath, area), config.baseUrl);

  if (config.pagination.mode === "query" && page > config.pagination.startPage) {
    url.searchParams.set(config.pagination.param, String(page));
  }
  return url;
}

export const scrapingBuildingDataSource: BuildingDataSource = {
  id: SCRAPING_SOURCE_ID,
  label: "スクレイピング取得（HTML 一覧ページ）",
  description:
    "自動取得が許可されているサイトの一覧ページから建物情報を取得します。取得先は lib/data-sources/scraping/sites.ts で設定します。",
  isDevelopment: false,
  // 取得できるかは設定次第。セレクタが指定されていなければ null になる。
  supportsUnitCount: true,
  supportsCoordinates: true,

  isAvailable(): DataSourceAvailability {
    if (SCRAPING_SITES.length === 0) {
      return {
        available: false,
        reason:
          "スクレイピングの取得先が未設定です。lib/data-sources/scraping/sites.ts の SCRAPING_SITES に、自動取得が許可されているサイトの設定を追加してください。",
      };
    }

    const config = getSelectedScrapingSite();
    if (!config) {
      return {
        available: false,
        reason: `SCRAPING_SITE_ID に一致する取得先設定が見つかりません（${
          process.env.SCRAPING_SITE_ID ?? "未指定"
        }）。`,
      };
    }

    return validateSiteConfig(config);
  },

  listAreas(): SupportedArea[] {
    const config = getSelectedScrapingSite();
    if (!config) return [];
    return validateSiteConfig(config).available ? expandCoverage(config.coverage) : [];
  },

  /**
   * 町丁目を列挙する。
   * 取得元が索引ページを持っている場合（townListPath 設定あり）だけ動く。
   */
  async listTowns(area: { prefecture: string; city: string }): Promise<string[]> {
    const availability = scrapingBuildingDataSource.isAvailable();
    if (!availability.available) return [];

    const config = getSelectedScrapingSite();
    if (!config?.townListPath || !config.townItemSelector) return [];
    if (!isKnownArea(area.prefecture, area.city)) return [];

    const robots = await fetchRobotsTxt(
      config.baseUrl,
      config.userAgent,
      config.politeness.timeoutMs,
    );
    if (robots.fetchError) return [];

    const url = new URL(
      fillAreaPlaceholders(config.townListPath, area),
      config.baseUrl,
    );
    const decision = isPathAllowed(
      robots.groups,
      config.userAgent,
      url.pathname + url.search,
    );
    if (!decision.allowed) return [];

    const fetcher = new PoliteFetcher(
      config.userAgent,
      config.politeness,
      decision.crawlDelayMs,
    );

    try {
      const html = await fetcher.fetchHtml(url);
      return parseTownIndex(html, config.townItemSelector);
    } catch {
      // 町名の列挙に失敗しても建物取得は続けられる。選択肢が減るだけ。
      return [];
    }
  },

  supportsArea(area: { prefecture: string; city: string }): boolean {
    const config = getSelectedScrapingSite();
    if (!config) return false;
    return expandCoverage(config.coverage).some(
      (a) => a.prefecture === area.prefecture && a.city === area.city,
    );
  },

  async fetchByArea(area: AreaQuery): Promise<FetchResult> {
    // 設定が整っていなければネットワークへ出ない
    const availability = scrapingBuildingDataSource.isAvailable();
    if (!availability.available) throw new Error(availability.reason);

    const config = getSelectedScrapingSite();
    if (!config) throw new Error("取得先設定を読み込めませんでした。");

    // 区は引数。対応範囲外なら取得しない。
    if (!scrapingBuildingDataSource.supportsArea?.({ ...area })) {
      throw new Error(
        `${config.label} は ${area.prefecture} ${area.city} に対応していません。`,
      );
    }

    const notes: string[] = [];

    // ── robots.txt を確認する。拒否なら回避せず中止 ────────────
    const robots = await fetchRobotsTxt(
      config.baseUrl,
      config.userAgent,
      config.politeness.timeoutMs,
    );
    if (robots.fetchError) throw new Error(robots.fetchError);

    const firstUrl = buildListUrl(config, area, config.pagination.mode === "query"
      ? config.pagination.startPage
      : 1);
    const decision = isPathAllowed(
      robots.groups,
      config.userAgent,
      firstUrl.pathname + firstUrl.search,
    );
    if (!decision.allowed) {
      throw new ScrapingStoppedError("robots_disallow", decision.reason ?? "robots.txt により拒否されました。");
    }

    const fetcher = new PoliteFetcher(
      config.userAgent,
      config.politeness,
      decision.crawlDelayMs,
    );
    notes.push(
      `リクエスト間隔 ${fetcher.requestIntervalMs}ms で逐次取得します（並列アクセスは行いません）。`,
    );
    if (decision.crawlDelayMs) {
      notes.push(`robots.txt の Crawl-delay を尊重しています（${decision.crawlDelayMs}ms）。`);
    }

    const maxPages =
      config.pagination.mode === "none"
        ? 1
        : Math.min(config.pagination.maxPages, config.politeness.maxPages);

    const buildings: SourceBuilding[] = [];
    const seen = new Set<string>();
    let currentUrl: URL | null = firstUrl;
    let page =
      config.pagination.mode === "query" ? config.pagination.startPage : 1;

    for (let visited = 0; visited < maxPages && currentUrl; visited++) {
      // 2 ページ目以降も robots.txt に従う
      if (visited > 0) {
        const nextDecision = isPathAllowed(
          robots.groups,
          config.userAgent,
          currentUrl.pathname + currentUrl.search,
        );
        if (!nextDecision.allowed) {
          notes.push(nextDecision.reason ?? "robots.txt により以降のページ取得を中止しました。");
          break;
        }
      }

      const html = await fetcher.fetchHtml(currentUrl);
      const parsed = parseListPage(html, config, currentUrl);

      if (parsed.itemCount === 0) {
        notes.push(
          `${currentUrl.toString()} で itemSelector「${config.itemSelector}」に一致する要素がありませんでした。セレクタ設定を見直してください。`,
        );
        break;
      }

      for (const building of parsed.buildings) {
        // 同じ建物を複数ページで拾った場合に備えて重複を落とす
        const key = `${building.source_ref ?? ""}|${building.address}|${building.building_name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        buildings.push(building);
        if (buildings.length >= config.politeness.maxItems) break;
      }

      if (buildings.length >= config.politeness.maxItems) {
        notes.push(`取得上限 ${config.politeness.maxItems} 件に達したため打ち切りました。`);
        break;
      }

      // ── 次ページ ────────────────────────────────────────────
      if (config.pagination.mode === "none") break;
      if (config.pagination.mode === "next-link") {
        currentUrl = parsed.nextPageUrl ? new URL(parsed.nextPageUrl) : null;
      } else {
        page += 1;
        currentUrl = buildListUrl(config, area, page);
      }
    }

    return { buildings, totalAvailable: buildings.length, notes };
  },
};

export { ScrapingStoppedError } from "./http";
export { parseListPage } from "./parse-html";
export {
  fetchRobotsTxt,
  isPathAllowed,
  parseRobotsTxt,
} from "./robots";
export {
  getScrapingSite,
  getSelectedScrapingSite,
  SCRAPING_SITES,
  TEMPLATE_SITE_CONFIG,
} from "./sites";
export {
  BLOCKED_HOSTS,
  DEFAULT_POLITENESS,
  isBlockedHost,
  type ComplianceRecord,
  type FieldSelector,
  type PaginationConfig,
  type PolitenessConfig,
  type ScrapableField,
  type ScrapingSiteConfig,
} from "./types";
