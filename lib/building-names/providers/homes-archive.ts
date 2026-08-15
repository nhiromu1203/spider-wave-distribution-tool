import "server-only";

/**
 * LIFULL HOME'S 不動産アーカイブから、街区ごとの建物名候補を集める。
 *
 * ── 取得の仕方 ──────────────────────────────────────────────
 * 1. 区の住所索引ページから、丁目ごとの一覧ページ URL を集める
 *    （URL は不透明なハッシュのため、区名から組み立てられない）
 * 2. 丁目の一覧ページを読み、「建物名」と「所在地」の対を取り出す
 *
 * 区名を個別に実装しないので、23区すべて同じ手順で動く。
 *
 * ── 負荷への配慮 ────────────────────────────────────────────
 * ・丁目単位でまとめて取り、建物 1 件ずつは取りにいかない
 * ・リクエスト間隔を空け、同時に投げない
 * ・一度読んだ丁目は記録し、次回以降は読み直さない
 * ・アクセス制限を迂回する処理は実装しない
 *
 * 取得したデータは各社の権利に属する。社内での配布先特定にのみ使うこと。
 * ────────────────────────────────────────────────────────────
 */

import { blockKeyOf, parseChomeNumber, toHalfWidth } from "../block-key";
import type { RawNameCandidate } from "../types";

const ORIGIN = "https://www.homes.co.jp";
const USER_AGENT =
  "SpiderWaveDistributionTool/1.0 (internal flyer distribution tool)";

/** 公開サイトへの配慮。連続して叩かない */
const MIN_INTERVAL_MS = 3_000;
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 直近の取得が失敗した理由。呼び出し側が原因を伝えられるようにする */
let lastFailure: string | null = null;

export function getLastFetchFailure(): string | null {
  return lastFailure;
}

export class AccessDeniedError extends Error {
  constructor(url: string) {
    super(
      `LIFULL HOME'S から拒否されました（HTTP 403）。${url}\n` +
        "このサイトは自ら名乗る User-Agent からのアクセスを受け付けません。" +
        "ブラウザを装えば通りますが、それはアクセス制限の回避にあたるため行いません。",
    );
    this.name = "AccessDeniedError";
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt > 0 && wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
      cache: "no-store",
    });

    // 403 は「取れなかった」ではなく「断られた」。
    // 黙って 0 件として扱うと、原因が分からないまま空振りし続ける。
    if (response.status === 403) {
      lastFailure = new AccessDeniedError(url).message;
      return null;
    }
    if (!response.ok) {
      lastFailure = `取得に失敗しました (HTTP ${response.status})。${url}`;
      return null;
    }

    lastFailure = null;
    return await response.text();
  } catch (error) {
    lastFailure = `接続できませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 丁目の一覧ページ。町名と丁目が分かるので、必要な分だけ取りにいける */
export type ChomeLink = {
  url: string;
  /** 町名（丁目を除く。例: 東日暮里） */
  town: string;
  chome: number;
};

/**
 * 索引ページの HTML から、丁目ごとの一覧ページを取り出す。
 *
 * リンクの直後に「荒川３丁目（238）」のような見出しが入っている。
 * これを読まないと、どの丁目のページか分からないまま
 * 全丁目（荒川区なら51件）を取りにいくことになる。
 */
export function parseChomeLinks(html: string, citySlug: string): ChomeLink[] {
  const pattern = new RegExp(
    `href="([^"]*?/archive/list/tokyo/${citySlug}/[^"]*?-addr/)"[^>]*>\\s*<span[^>]*>([^<]+)</span>`,
    "g",
  );

  const links: ChomeLink[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(pattern)) {
    const url = m[1].startsWith("http") ? m[1] : `${ORIGIN}${m[1]}`;
    if (seen.has(url)) continue;

    const label = toHalfWidth(m[2]);
    const parsed = label.match(/^(.+?)([0-9]+|[一二三四五六七八九十]+)丁目$/);
    if (!parsed) continue;

    const chome = parseChomeNumber(parsed[2]);
    if (chome === null) continue;

    seen.add(url);
    links.push({ url, town: parsed[1], chome });
  }

  return links;
}

/**
 * 区の住所索引から、丁目ごとの一覧ページを集める。
 * URL はハッシュ付きで組み立てられないため、ここで拾うしかない。
 */
export async function discoverChomeLinks(citySlug: string): Promise<ChomeLink[]> {
  const html = await fetchHtml(`${ORIGIN}/archive/address/tokyo/${citySlug}/`);
  return html ? parseChomeLinks(html, citySlug) : [];
}

/**
 * 一覧ページの HTML から「建物名」と「所在地」を取り出す。
 *
 * 建物ごとに /archive/b-数字/ へのリンクがあり、その中に
 *   <span class="font-bold">建物名</span>
 *   …荒川区東日暮里4丁目32-10
 * という並びで入っている。
 */
export function parseListPage(html: string): RawNameCandidate[] {
  const results: RawNameCandidate[] = [];

  // 建物ごとの塊に切り分ける
  const blocks = html.split(/<a href="[^"]*\/archive\/b-\d+\/"/).slice(1);

  for (const block of blocks) {
    const name = block.match(/<span class="font-bold">([^<]+)<\/span>/)?.[1]?.trim();
    if (!name) continue;

    // 「○○区○○町N丁目N-N」の形。号が無いものもある。
    const address = block
      .match(/([^\s<>"]*?[市区町村][^\s<>"]*?\d+丁目\d+(?:-\d+)?)/)?.[1]
      ?.trim();
    if (!address) continue;

    // 街区を取り出せないものは、照合に使えないので捨てる
    if (!blockKeyOf(address)) continue;

    results.push({ name, address, source: "homes_archive" });
  }

  return results;
}

/** 丁目の一覧ページを、必要なページ数だけ読む */
export async function fetchChomeCandidates(
  chomeUrl: string,
  maxPages = 3,
): Promise<RawNameCandidate[]> {
  const all: RawNameCandidate[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? chomeUrl : `${chomeUrl}?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) break;

    const parsed = parseListPage(html);
    if (parsed.length === 0) break;

    all.push(...parsed);
  }

  // 同じ建物が複数ページに出ることがある
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.name}|${c.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
