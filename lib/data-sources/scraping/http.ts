/**
 * 取得先へのアクセス制御。
 *
 * ── 方針 ────────────────────────────────────────────────────
 * ・逐次アクセスのみ。並列取得はしない
 * ・リクエスト間に必ず間隔を空ける（robots.txt の Crawl-delay を優先）
 * ・403 / 429 / CAPTCHA を検知したら即座に停止する
 * ・回避処理（User-Agent の付け替え、プロキシ経由での再試行、
 *   CAPTCHA の突破）は実装しない
 * ・リトライはネットワーク断と 5xx に限り、回数上限を設ける
 * ────────────────────────────────────────────────────────────
 */

import type { PolitenessConfig } from "./types";

/** 取得を「中止すべき」と判断した理由 */
export type StopReason =
  | "forbidden"
  | "rate_limited"
  | "captcha"
  | "robots_disallow"
  | "too_many_failures";

export class ScrapingStoppedError extends Error {
  readonly reason: StopReason;
  readonly status: number | null;

  constructor(reason: StopReason, message: string, status: number | null = null) {
    super(message);
    this.name = "ScrapingStoppedError";
    this.reason = reason;
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** CAPTCHA / bot 検知ページの典型的な痕跡 */
const CAPTCHA_MARKERS = [
  "captcha",
  "recaptcha",
  "hcaptcha",
  "cf-challenge",
  "cf_chl_opt",
  "are you a robot",
  "認証にご協力ください",
  "ロボットではありません",
  "アクセスが制限されています",
];

export function looksLikeCaptcha(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  return CAPTCHA_MARKERS.some((marker) => head.includes(marker.toLowerCase()));
}

/**
 * 逐次アクセス用のクライアント。
 * 1 インスタンスにつき同時に 1 リクエストしか出さない。
 */
export class PoliteFetcher {
  private lastRequestAt = 0;
  private readonly intervalMs: number;

  constructor(
    private readonly userAgent: string,
    private readonly politeness: PolitenessConfig,
    crawlDelayMs: number | null,
  ) {
    // robots.txt の Crawl-delay と設定値の「長い方」を採用する
    this.intervalMs = Math.max(politeness.minIntervalMs, crawlDelayMs ?? 0);
  }

  /** 実際に使われるリクエスト間隔（ms） */
  get requestIntervalMs(): number {
    return this.intervalMs;
  }

  private async waitForTurn(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const remaining = this.intervalMs - elapsed;
    if (this.lastRequestAt > 0 && remaining > 0) await sleep(remaining);
    this.lastRequestAt = Date.now();
  }

  /**
   * HTML を 1 ページ取得する。
   * 中止すべき応答を受けたら ScrapingStoppedError を投げ、呼び出し側は取得を打ち切る。
   */
  async fetchHtml(url: URL): Promise<string> {
    let lastError: string = "不明なエラー";

    for (let attempt = 0; attempt <= this.politeness.maxRetries; attempt++) {
      await this.waitForTurn();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.politeness.timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            // 正直に名乗る。ブラウザや他のクローラを装わない。
            "User-Agent": this.userAgent,
            Accept: "text/html,application/xhtml+xml",
          },
          signal: controller.signal,
          redirect: "follow",
          cache: "no-store",
        });
      } catch (error) {
        clearTimeout(timer);
        lastError =
          error instanceof Error && error.name === "AbortError"
            ? `タイムアウト（${this.politeness.timeoutMs}ms）`
            : error instanceof Error
              ? error.message
              : String(error);
        // ネットワーク断は一時的な可能性があるので、上限まではやり直す
        if (attempt < this.politeness.maxRetries) {
          await sleep(this.politeness.retryBackoffMs * (attempt + 1));
          continue;
        }
        break;
      }
      clearTimeout(timer);

      // ── 中止すべき応答。回避せず、ここで手を引く ──────────────
      if (response.status === 403) {
        throw new ScrapingStoppedError(
          "forbidden",
          "取得先から 403 Forbidden が返されました。自動アクセスが拒否されているため取得を中止します。回避処理は行いません。",
          403,
        );
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new ScrapingStoppedError(
          "rate_limited",
          `取得先から 429 Too Many Requests が返されました。取得を中止します。${
            retryAfter ? `（Retry-After: ${retryAfter}）` : ""
          }時間を空け、取得間隔を長くしてから再実行してください。`,
          429,
        );
      }
      if (response.status === 401 || response.status === 451) {
        throw new ScrapingStoppedError(
          "forbidden",
          `取得先から HTTP ${response.status} が返されました。アクセスが許可されていないため取得を中止します。`,
          response.status,
        );
      }

      if (response.status >= 500) {
        lastError = `HTTP ${response.status} ${response.statusText}`;
        if (attempt < this.politeness.maxRetries) {
          await sleep(this.politeness.retryBackoffMs * (attempt + 1));
          continue;
        }
        break;
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status} ${response.statusText}`;
        break;
      }

      const html = await response.text();

      if (looksLikeCaptcha(html)) {
        throw new ScrapingStoppedError(
          "captcha",
          "取得先から CAPTCHA / bot 検知ページが返されました。取得を中止します。突破処理は行いません。",
          response.status,
        );
      }

      return html;
    }

    throw new ScrapingStoppedError(
      "too_many_failures",
      `取得に失敗しました（${this.politeness.maxRetries + 1} 回試行）: ${lastError}`,
    );
  }
}
