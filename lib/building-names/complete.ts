"use server";

/**
 * 建物名が分からない建物に、外部サイトの情報から名前を付ける。
 *
 * ── 進め方 ──────────────────────────────────────────────────
 * 1. 対象の建物を街区ごとにまとめる
 * 2. まだ調べていない街区だけ、外部サイトへ候補を問い合わせる
 * 3. 候補の住所（号まで）を座標に変換する
 * 4. 街区単位で対象と候補を突き合わせる
 * 5. HIGH と判定できたものだけ建物名を保存する
 *
 * ── 守っていること ──────────────────────────────────────────
 * ・人が入力した名前（name_source = 'manual'）は決して上書きしない
 * ・AMBIGUOUS は自動採用しない。人の確認に回す
 * ・一度調べた街区は記録し、次回以降は問い合わせない
 * ・1 リクエストの実行時間に上限があるため、街区数で区切って処理する
 * ────────────────────────────────────────────────────────────
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCity } from "@/lib/data-sources/areas";
import { UNKNOWN_BUILDING_NAME } from "@/lib/data-sources/types";
import { blockKeyOf } from "./block-key";
import { geocodeAddress, GSI_ATTRIBUTION } from "./geocode";
import { matchBuildingNames, type NameCandidate } from "./match";
import {
  discoverChomeLinks,
  fetchChomeCandidates,
  getLastFetchFailure,
} from "./providers/homes-archive";
import type { NameCompletionSummary, RawNameCandidate } from "./types";

const SOURCE_ID = "homes_archive";

/** 1 回の実行で扱う街区の数。実行時間の上限に収めるため */
const BLOCKS_PER_RUN = 6;

type BuildingRow = {
  id: string;
  building_name: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  name_source: string | null;
};

export async function completeBuildingNames(area: {
  prefecture: string;
  city: string;
}): Promise<NameCompletionSummary> {
  const empty: NameCompletionSummary = {
    examined: 0,
    applied: 0,
    ambiguous: 0,
    notFound: 0,
    skippedBlocks: 0,
    fetchedBlocks: 0,
    notes: [],
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ...empty, notes: ["ログインが必要です。"] };

  const cityMaster = getCity(area.prefecture, area.city);
  if (!cityMaster?.slug) {
    return {
      ...empty,
      notes: [`${area.city} は建物名の補完に対応していません。`],
    };
  }

  // ── 対象の建物 ────────────────────────────────────────────
  // 人が入力した名前は対象にしない（上書きしないため）
  const { data, error } = await supabase
    .from("buildings")
    .select("id,building_name,address,latitude,longitude,name_source")
    .eq("prefecture", area.prefecture)
    .eq("city", area.city)
    .not("latitude", "is", null)
    .or(`building_name.is.null,building_name.eq."${UNKNOWN_BUILDING_NAME}"`)
    .limit(2000);

  if (error) {
    return { ...empty, notes: [`対象の取得に失敗しました: ${error.message}`] };
  }

  const targets = ((data ?? []) as BuildingRow[]).filter(
    (b) => b.name_source !== "manual" && b.latitude !== null,
  );
  if (targets.length === 0) {
    return { ...empty, notes: ["建物名が未設定の建物はありません。"] };
  }

  // ── 街区ごとにまとめる ────────────────────────────────────
  const byBlock = new Map<string, BuildingRow[]>();
  for (const b of targets) {
    const key = blockKeyOf(b.address);
    if (!key) continue;
    (byBlock.get(key) ?? byBlock.set(key, []).get(key)!).push(b);
  }

  // すでに調べた街区は除く
  const { data: done } = await supabase
    .from("building_name_lookups")
    .select("block_key,candidates")
    .eq("prefecture", area.prefecture)
    .eq("city", area.city)
    .eq("source", SOURCE_ID);

  const known = new Map<string, RawNameCandidate[]>(
    (done ?? []).map((r) => [
      r.block_key as string,
      (r.candidates ?? []) as RawNameCandidate[],
    ]),
  );

  const pending = [...byBlock.keys()].filter((k) => !known.has(k));
  const summary: NameCompletionSummary = {
    ...empty,
    skippedBlocks: byBlock.size - pending.length,
  };

  // ── 未調査の街区だけ外部サイトへ問い合わせる ──────────────
  if (pending.length > 0) {
    const chomeLinks = await discoverChomeLinks(cityMaster.slug);
    if (chomeLinks.length === 0) {
      // 失敗の理由をそのまま返す。件数 0 だけでは原因が分からない。
      summary.notes.push(
        getLastFetchFailure() ?? "丁目一覧のURLを取得できませんでした。",
      );
      return summary;
    }

    // 未調査の街区が属する丁目だけを取りにいく。
    // 索引の全丁目（荒川区なら51件）を舐めると無駄な問い合わせが大量に出る。
    const wanted = new Set(
      pending.map((k) => k.split("/").slice(0, 2).join("/")),
    );
    const targetLinks = chomeLinks.filter((l) =>
      wanted.has(`${l.town}/${l.chome}`),
    );

    const collected = new Map<string, RawNameCandidate[]>();
    // 丁目ページ 1 枚で複数の街区がまかなえるため、丁目単位で取りにいく
    for (const link of targetLinks) {
      if (collected.size >= BLOCKS_PER_RUN) break;

      const candidates = await fetchChomeCandidates(link.url);
      let useful = false;
      for (const c of candidates) {
        const key = blockKeyOf(c.address);
        if (!key || !pending.includes(key) || known.has(key)) continue;
        useful = true;
        (collected.get(key) ?? collected.set(key, []).get(key)!).push(c);
      }
      if (useful) summary.fetchedBlocks++;
    }

    for (const [key, candidates] of collected) {
      known.set(key, candidates);
      await supabase.from("building_name_lookups").upsert(
        {
          block_key: key,
          prefecture: area.prefecture,
          city: area.city,
          source: SOURCE_ID,
          candidates,
          candidate_count: candidates.length,
        },
        { onConflict: "block_key,source" },
      );
    }
  }

  // ── 判定と保存 ────────────────────────────────────────────
  for (const [key, buildings] of byBlock) {
    const raw = known.get(key);
    if (!raw) continue;

    const located: NameCandidate[] = [];
    for (const c of raw) {
      const point = await geocodeAddress(
        c.address.startsWith("東京都") ? c.address : `${area.prefecture}${c.address}`,
      );
      if (!point) continue;
      located.push({ ...point, name: c.name, address: c.address, source: c.source });
    }

    const results = matchBuildingNames(
      buildings.map((b) => ({
        id: b.id,
        latitude: b.latitude as number,
        longitude: b.longitude as number,
      })),
      located,
    );

    for (const r of results) {
      summary.examined++;
      if (r.verdict === "HIGH" && r.name) {
        const { error: updateError } = await supabase
          .from("buildings")
          .update({
            building_name: r.name,
            name_source: "auto",
            name_decided_at: new Date().toISOString(),
          })
          .eq("id", r.id)
          // 競合で人の入力を消さないための最後の砦
          .neq("name_source", "manual");

        if (updateError) summary.notes.push(`保存に失敗: ${updateError.message}`);
        else summary.applied++;
      } else if (r.verdict === "AMBIGUOUS") {
        summary.ambiguous++;
      } else {
        summary.notFound++;
      }
    }
  }

  summary.notes.push(
    `調査済みのため問い合わせを省いた街区: ${summary.skippedBlocks}`,
    `出典: LIFULL HOME'S 不動産アーカイブ / ${GSI_ATTRIBUTION}`,
  );

  revalidatePath("/buildings");
  return summary;
}
