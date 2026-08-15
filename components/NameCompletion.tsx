"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeBuildingNames } from "@/lib/building-names/complete";
import type { NameCompletionSummary } from "@/lib/building-names/types";

/**
 * 建物名が分からない建物に、外部サイトの情報から名前を付ける。
 *
 * 自動で付くのは判定が HIGH のものだけ。決めきれなかったものは
 * 一覧から手で入力してもらう（人の入力は自動処理で上書きしない）。
 *
 * 1 回の実行では街区をいくつかずつ処理する。実行時間の上限があるため、
 * 続きがあるあいだは繰り返し押してもらう形にしている。
 */
export function NameCompletion({
  prefecture,
  city,
}: {
  prefecture: string | null;
  city: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<NameCompletionSummary | null>(null);

  const run = useCallback(() => {
    if (!prefecture || !city) return;
    startTransition(async () => {
      const result = await completeBuildingNames({ prefecture, city });
      setSummary(result);
      router.refresh();
    });
  }, [prefecture, city, router]);

  if (!prefecture || !city) return null;

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
      <span>建物名の補完</span>

      <button type="button" className="btn" onClick={run} disabled={pending}>
        {pending ? "照合中…" : "建物名を調べる"}
      </button>

      {pending && (
        <span className="text-[var(--text-muted)]">
          外部サイトへの問い合わせと座標照合を行っています。1 分ほどかかります…
        </span>
      )}

      {summary && (
        <div className="w-full text-xs text-[var(--text-muted)]">
          <p className="text-sm text-[var(--text)]">
            判定 {summary.examined} 件 ／ 自動で名前を付けた{" "}
            <strong>{summary.applied}</strong> 件 ／ 要確認{" "}
            <strong>{summary.ambiguous}</strong> 件 ／ 候補なし {summary.notFound} 件
          </p>
          {summary.ambiguous > 0 && (
            <p className="mt-1">
              要確認のものは自動で付けていません。同じ街区に似た距離の候補が複数あり、
              取り違えると配布先を誤るためです。一覧の建物名欄から手で入力してください。
            </p>
          )}
          <ul className="mt-1 list-disc pl-5">
            {summary.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
