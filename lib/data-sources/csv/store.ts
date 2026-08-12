import "server-only";

/**
 * 建物一覧 CSV データセットの保管。
 *
 * アップロードされた CSV は解析済みの SourceBuilding[] として
 * サーバー側のディレクトリに JSON で保存する。
 * これにより CsvBuildingDataSource は他の取得元と同じく
 * 「エリアを指定して引く」形で扱える。
 *
 * 保存先は BUILDING_CSV_DIR で変更できる（既定: <プロジェクト>/data/buildings）。
 * DB スキーマには一切手を入れない。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceBuilding } from "../types";

export type CsvDatasetMeta = {
  /** ファイル名から作った識別子 */
  id: string;
  /** 元のファイル名 */
  fileName: string;
  encoding: string;
  buildingCount: number;
  skippedRows: number;
  uploadedAt: string;
  /** データセットに含まれるエリア */
  areas: Array<{ prefecture: string; city: string; count: number }>;
};

export type CsvDataset = CsvDatasetMeta & {
  buildings: SourceBuilding[];
};

function datasetDir(): string {
  return process.env.BUILDING_CSV_DIR?.trim()
    ? path.resolve(process.env.BUILDING_CSV_DIR.trim())
    : path.join(process.cwd(), "data", "buildings");
}

/** ファイル名から安全な識別子を作る（パス区切りなどを除去） */
export function toDatasetId(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return safe || "dataset";
}

/** データセットに含まれるエリアを集計する */
export function summarizeAreas(buildings: SourceBuilding[]): CsvDatasetMeta["areas"] {
  const counts = new Map<string, { prefecture: string; city: string; count: number }>();

  for (const b of buildings) {
    if (!b.prefecture || !b.city) continue;
    const key = `${b.prefecture}/${b.city}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { prefecture: b.prefecture, city: b.city, count: 1 });
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.city.localeCompare(b.city, "ja"),
  );
}

/** 読み込んだデータセットのキャッシュ（mtime が変わったら読み直す） */
const cache = new Map<string, { mtimeMs: number; dataset: CsvDataset }>();

export async function saveDataset(
  fileName: string,
  buildings: SourceBuilding[],
  info: { encoding: string; skippedRows: number },
): Promise<CsvDatasetMeta> {
  const dir = datasetDir();
  await fs.mkdir(dir, { recursive: true });

  const id = toDatasetId(fileName);
  const meta: CsvDatasetMeta = {
    id,
    fileName,
    encoding: info.encoding,
    buildingCount: buildings.length,
    skippedRows: info.skippedRows,
    uploadedAt: new Date().toISOString(),
    areas: summarizeAreas(buildings),
  };

  const dataset: CsvDataset = { ...meta, buildings };
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify(dataset),
    "utf8",
  );
  cache.delete(id);

  return meta;
}

async function readDataset(id: string): Promise<CsvDataset | null> {
  const file = path.join(datasetDir(), `${id}.json`);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }

  const cached = cache.get(id);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.dataset;

  try {
    const dataset = JSON.parse(await fs.readFile(file, "utf8")) as CsvDataset;
    cache.set(id, { mtimeMs: stat.mtimeMs, dataset });
    return dataset;
  } catch {
    return null;
  }
}

export async function listDatasetIds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(datasetDir());
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    // ディレクトリが無い＝データセット未登録
    return [];
  }
}

export async function listDatasets(): Promise<CsvDatasetMeta[]> {
  const ids = await listDatasetIds();
  const datasets: CsvDatasetMeta[] = [];

  for (const id of ids) {
    const dataset = await readDataset(id);
    if (!dataset) continue;
    const { buildings: _buildings, ...meta } = dataset;
    void _buildings;
    datasets.push(meta);
  }

  return datasets.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** すべてのデータセットの建物を連結して返す */
export async function loadAllBuildings(): Promise<SourceBuilding[]> {
  const ids = await listDatasetIds();
  const all: SourceBuilding[] = [];

  for (const id of ids) {
    const dataset = await readDataset(id);
    if (dataset) all.push(...dataset.buildings);
  }

  return all;
}

/** 保存先ディレクトリ（画面表示・案内用） */
export function getDatasetDirectory(): string {
  return datasetDir();
}
