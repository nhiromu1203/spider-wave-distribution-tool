import "server-only";

/**
 * 国土交通省「街区レベル位置参照情報」の取得と保管。
 *
 * ── 外部への問い合わせは初回だけ ────────────────────────────
 * 都道府県ごとに ZIP を 1 回だけダウンロードし、解析結果を
 * ローカルへ JSON で保存する。2 回目以降は保存済みファイルを読むだけで、
 * 外部へは一切アクセスしない。
 *
 * ── 出典表示 ────────────────────────────────────────────────
 * 「街区レベル位置参照情報　国土交通省」の表示が必要。
 * 画面には ATTRIBUTION を出すこと。
 * ────────────────────────────────────────────────────────────
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";

export const ATTRIBUTION = "街区レベル位置参照情報　国土交通省";

/** 位置参照情報のデータ版。新しい版が出たらここを変える */
const DEFAULT_VERSION = "24.0a";

/** 街区の基準点 1 件 */
export type BlockPoint = {
  /** 大字・丁目名（例: 東日暮里一丁目） */
  town: string;
  /** 街区符号（例: 5） */
  block: string;
  latitude: number;
  longitude: number;
};

export type PrefectureDataset = {
  prefectureCode: string;
  prefectureName: string;
  version: string;
  downloadedAt: string;
  /** 市区町村名 → 街区点 */
  byCity: Record<string, BlockPoint[]>;
  totalPoints: number;
};

function datasetVersion(): string {
  return process.env.ISJ_DATA_VERSION?.trim() || DEFAULT_VERSION;
}

function datasetDir(): string {
  return process.env.ADDRESS_REFERENCE_DIR?.trim()
    ? path.resolve(process.env.ADDRESS_REFERENCE_DIR.trim())
    : path.join(process.cwd(), "data", "address-reference");
}

function downloadUrl(prefectureCode: string): string {
  const version = datasetVersion();
  const base =
    process.env.ISJ_BASE_URL?.trim() || "https://nlftp.mlit.go.jp/isj/dls/data";
  return `${base}/${version}/${prefectureCode}000-${version}.zip`;
}

function cacheFile(prefectureCode: string): string {
  return path.join(
    datasetDir(),
    `isj-${prefectureCode}-${datasetVersion()}.json`,
  );
}

/**
 * ZIP の中から最初の CSV を取り出す。
 *
 * 依存を増やさないため、ZIP の構造を直接読む。
 * 位置参照情報の ZIP は「格納方式 deflate または無圧縮の単一 CSV」であり、
 * この範囲だけを扱う。
 */
function extractCsvFromZip(zip: Buffer): Promise<Buffer> {
  // End of central directory を後ろから探す
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 66_000; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP の構造を解釈できませんでした。");

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) break;

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("latin1");

    offset += 46 + nameLength + extraLength + commentLength;

    if (!name.toLowerCase().endsWith(".csv")) continue;

    // ローカルファイルヘッダから実データの位置を求める
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) return Promise.resolve(Buffer.from(data));
    if (method === 8) return inflateRaw(Buffer.from(data));
    throw new Error(`ZIP の圧縮方式 ${method} には対応していません。`);
  }

  throw new Error("ZIP の中に CSV が見つかりませんでした。");
}

function inflateRaw(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // gzip ヘッダを付けずに raw deflate を展開する
    const zlib = require("node:zlib") as typeof import("node:zlib");
    zlib.inflateRaw(data, (error, result) => {
      if (error) reject(new Error(`ZIP の展開に失敗しました: ${error.message}`));
      else resolve(result);
    });
    void createGunzip;
  });
}

/** 位置参照情報 CSV（Shift_JIS）を解析する */
export function parseIsjCsv(csv: Buffer): {
  byCity: Record<string, BlockPoint[]>;
  prefectureName: string;
  totalPoints: number;
} {
  const text = new TextDecoder("shift_jis").decode(csv);
  const lines = text.split(/\r?\n/);

  const byCity: Record<string, BlockPoint[]> = {};
  let prefectureName = "";
  let totalPoints = 0;

  // 列: 都道府県名, 市区町村名, 大字・丁目名, 小字・通称名,
  //     街区符号・地番, 座標系番号, X, Y, 緯度, 経度, 住居表示フラグ, 代表フラグ, ...
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    if (cells.length < 10) continue;

    const [prefecture, city, town, , block] = cells;
    const latitude = Number(cells[8]);
    const longitude = Number(cells[9]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (!city || !town || !block) continue;

    prefectureName ||= prefecture;
    (byCity[city] ??= []).push({ town, block, latitude, longitude });
    totalPoints++;
  }

  return { byCity, prefectureName, totalPoints };
}

/** 読み込み済みデータセット（プロセス内キャッシュ） */
const memoryCache = new Map<string, PrefectureDataset>();

/** 保存済みデータセットがあるか */
export async function isDatasetCached(prefectureCode: string): Promise<boolean> {
  if (memoryCache.has(prefectureCode)) return true;
  try {
    await fs.access(cacheFile(prefectureCode));
    return true;
  } catch {
    return false;
  }
}

/**
 * 都道府県のデータセットを取得する。
 * 保存済みならファイルから読み、無ければ 1 回だけダウンロードして保存する。
 */
export async function loadPrefectureDataset(
  prefectureCode: string,
  options: { allowDownload?: boolean } = {},
): Promise<PrefectureDataset> {
  const cached = memoryCache.get(prefectureCode);
  if (cached) return cached;

  const file = cacheFile(prefectureCode);

  // 1. ローカルの保存済みファイル
  try {
    const dataset = JSON.parse(await fs.readFile(file, "utf8")) as PrefectureDataset;
    memoryCache.set(prefectureCode, dataset);
    return dataset;
  } catch {
    // 未取得。以降でダウンロードする
  }

  if (options.allowDownload === false) {
    throw new Error(
      `位置参照情報（都道府県コード ${prefectureCode}）が未取得です。初回のみダウンロードが必要です。`,
    );
  }

  // 2. 初回のみダウンロード
  const url = downloadUrl(prefectureCode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "SpiderWaveDistributionTool/1.0 (internal tool)" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      `位置参照情報のダウンロードに失敗しました: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `位置参照情報のダウンロードに失敗しました (HTTP ${response.status})。URL: ${url}`,
    );
  }

  const zip = Buffer.from(await response.arrayBuffer());
  const csv = await extractCsvFromZip(zip);
  const { byCity, prefectureName, totalPoints } = parseIsjCsv(csv);

  const dataset: PrefectureDataset = {
    prefectureCode,
    prefectureName,
    version: datasetVersion(),
    downloadedAt: new Date().toISOString(),
    byCity,
    totalPoints,
  };

  await fs.mkdir(datasetDir(), { recursive: true });
  await fs.writeFile(file, JSON.stringify(dataset), "utf8");
  memoryCache.set(prefectureCode, dataset);

  return dataset;
}

/**
 * 市区町村に含まれる街区点を返す。
 *
 * 住所補完だけでなく、区の範囲や規模を知るためにも使う。
 * すでに保存済みのデータを読むだけで、外部への問い合わせは発生しない。
 */
export async function getCityBlockPoints(
  prefectureCode: string,
  city: string,
  options: { allowDownload?: boolean } = {},
): Promise<BlockPoint[]> {
  const dataset = await loadPrefectureDataset(prefectureCode, options);
  return dataset.byCity[city] ?? [];
}

export function getDatasetDirectory(): string {
  return datasetDir();
}

export function clearDatasetMemoryCache(): void {
  memoryCache.clear();
}
