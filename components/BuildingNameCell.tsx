"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBuildingName } from "@/lib/buildings/actions";
import { UNKNOWN_BUILDING_NAME } from "@/lib/data-sources/types";

/**
 * 建物名の表示と手入力。
 *
 * OpenStreetMap には建物名がほとんど入っていないため、配布時に現地で見た名前を
 * その場で登録できるようにする。一度登録すれば次回取得時も保持される。
 */
export function BuildingNameCell({
  buildingId,
  buildingName,
}: {
  buildingId: string;
  buildingName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(buildingName === UNKNOWN_BUILDING_NAME ? "" : buildingName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isUnknown = buildingName === UNKNOWN_BUILDING_NAME;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateBuildingName(buildingId, value);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="field w-56 py-1"
            value={value}
            placeholder="例：グランドメゾン日暮里"
            disabled={pending}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            type="button"
            className="btn btn-primary px-2 py-1 text-xs"
            onClick={save}
            disabled={pending}
          >
            {pending ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={pending}
          >
            取消
          </button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {isUnknown ? (
        <span className="text-[var(--text-muted)]">{UNKNOWN_BUILDING_NAME}</span>
      ) : (
        <span className="font-medium">{buildingName}</span>
      )}
      <button
        type="button"
        className="text-xs text-[var(--accent)] underline"
        onClick={() => setEditing(true)}
        title="現地で確認した建物名を登録できます"
      >
        {isUnknown ? "名前を入力" : "編集"}
      </button>
    </span>
  );
}
