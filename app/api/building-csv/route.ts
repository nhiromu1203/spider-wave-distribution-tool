import { NextResponse } from "next/server";
import {
  CSV_MAX_ROWS_DEFAULT,
  CSV_SOURCE_ID,
  parseBuildingCsv,
  refreshCsvAreas,
  saveDataset,
} from "@/lib/data-sources/csv";
import { listDatasets } from "@/lib/data-sources/csv/store";

/**
 * 建物一覧 CSV のアップロード。
 *
 * 10万件規模のファイルを扱うため Server Action ではなく Route Handler にしている
 * （Server Action のリクエストボディ上限に収まらないため）。
 * 認証は他の画面と同じく Supabase のセッションで判定する。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 大きなファイルの解析に時間がかかるため上限を延ばす
export const maxDuration = 60;

export async function GET() {
  const datasets = await listDatasets();
  await refreshCsvAreas();
  return NextResponse.json({ datasets });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "ファイルを受け取れませんでした。" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "CSV ファイルを選択してください。" },
      { status: 400 },
    );
  }

  if (!/\.csv$/i.test(file.name)) {
    return NextResponse.json(
      {
        error:
          "CSV ファイルを選択してください。Excel の場合は「CSV UTF-8」形式で書き出してください。",
      },
      { status: 400 },
    );
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = parseBuildingCsv(buffer, {
      sourceId: CSV_SOURCE_ID,
      datasetName: file.name.replace(/\.csv$/i, ""),
      maxRows: CSV_MAX_ROWS_DEFAULT,
    });

    if (!result.columnMap.address) {
      return NextResponse.json(
        {
          error:
            "住所の列が見つかりませんでした。ヘッダー行に「住所」（または所在地）を含めてください。",
          headers: result.headers,
          encoding: result.encoding,
        },
        { status: 400 },
      );
    }

    const meta = await saveDataset(file.name, result.buildings, {
      encoding: result.encoding,
      skippedRows: result.skippedRows,
    });
    await refreshCsvAreas();

    return NextResponse.json({
      dataset: meta,
      encoding: result.encoding,
      headers: result.headers,
      columnMap: result.columnMap,
      totalRows: result.totalRows,
      importedRows: result.buildings.length,
      skippedRows: result.skippedRows,
      skippedSamples: result.skippedSamples,
      maxRows: CSV_MAX_ROWS_DEFAULT,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `CSV の取り込みに失敗しました: ${error.message}`
            : "CSV の取り込みに失敗しました。",
      },
      { status: 500 },
    );
  }
}
