"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  SORT_OPTIONS,
  filtersToSearchParams,
  type BuildingFilters,
} from "@/lib/buildings/filters";
import type { AreaOptions } from "@/lib/buildings/queries";
import {
  MIN_TOTAL_UNITS_DEFAULT,
  PROPERTY_TYPE_LABEL,
  STATUS_LABEL,
  type BuildingStatus,
  type PropertyType,
} from "@/lib/supabase/types";

const ALL_TYPES: PropertyType[] = ["rental", "condominium", "unknown"];
const ALL_STATUSES: BuildingStatus[] = [
  "NOT_DISTRIBUTED",
  "POSSIBLE_DUPLICATE",
  "CONFIRMED_DISTRIBUTED",
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function BuildingFilterBar({
  filters,
  areas,
}: {
  filters: BuildingFilters;
  areas: AreaOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<BuildingFilters>(filters);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(filters),
    [draft, filters],
  );

  const apply = (next: BuildingFilters) => {
    const params = filtersToSearchParams({ ...next, page: 1 });
    startTransition(() => router.push(`/buildings?${params.toString()}`));
  };

  const update = (patch: Partial<BuildingFilters>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  /** エリアは選び直した時点で即反映する（下位の選択肢を取り直すため） */
  const applyArea = (patch: Partial<BuildingFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    apply(next);
  };

  return (
    <form
      className="card space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply(draft);
      }}
    >
      {/* エリア指定 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="prefecture">
            都道府県
          </label>
          <select
            id="prefecture"
            className="field"
            value={draft.prefecture ?? ""}
            onChange={(e) =>
              applyArea({
                prefecture: e.target.value || null,
                city: null,
                town: null,
              })
            }
          >
            <option value="">すべて</option>
            {areas.prefectures.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="city">
            市区町村
          </label>
          <select
            id="city"
            className="field"
            value={draft.city ?? ""}
            disabled={!draft.prefecture}
            onChange={(e) => applyArea({ city: e.target.value || null, town: null })}
          >
            <option value="">
              {draft.prefecture ? "すべて（市区町村全体）" : "先に都道府県を選択"}
            </option>
            {areas.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="town">
            町名
          </label>
          <select
            id="town"
            className="field"
            value={draft.town ?? ""}
            disabled={!draft.city}
            onChange={(e) => applyArea({ town: e.target.value || null })}
          >
            <option value="">
              {draft.city ? "すべて（市区町村全体）" : "先に市区町村を選択"}
            </option>
            {areas.towns.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="q">
            建物名 / 住所で検索
          </label>
          <input
            id="q"
            className="field"
            value={draft.keyword ?? ""}
            placeholder="例：グランドメゾン"
            onChange={(e) => update({ keyword: e.target.value || null })}
          />
        </div>
      </div>

      {/* 条件 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_1fr_1fr_auto]">
        <div>
          <label className="label" htmlFor="minUnits">
            最低世帯数
          </label>
          <div className="flex items-center gap-2">
            <input
              id="minUnits"
              type="number"
              min={0}
              className="field w-24"
              value={draft.minUnits}
              onChange={(e) =>
                update({ minUnits: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <label className="flex items-center gap-1 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={draft.includeUnknownUnits}
                onChange={(e) => update({ includeUnknownUnits: e.target.checked })}
              />
              不明も含める
            </label>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {draft.includeUnknownUnits
              ? `世帯数不明は除外しません（${draft.minUnits}世帯未満のみ非表示）`
              : `${draft.minUnits}世帯未満と不明を非表示`}
            {draft.minUnits !== MIN_TOTAL_UNITS_DEFAULT &&
              `／既定は ${MIN_TOTAL_UNITS_DEFAULT} 世帯`}
          </p>
        </div>

        <fieldset>
          <legend className="label">種別</legend>
          <div className="flex flex-wrap gap-3 pt-1">
            {ALL_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={draft.propertyTypes.includes(t)}
                  onChange={() =>
                    update({ propertyTypes: toggle(draft.propertyTypes, t) })
                  }
                />
                {PROPERTY_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">配布状況</legend>
          <div className="flex flex-wrap gap-3 pt-1">
            {ALL_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={draft.statuses.includes(s)}
                  onChange={() => update({ statuses: toggle(draft.statuses, s) })}
                />
                {STATUS_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="sort">
            並び替え
          </label>
          <select
            id="sort"
            className="field"
            value={draft.sort}
            onChange={(e) => {
              const next = { ...draft, sort: e.target.value as BuildingFilters["sort"] };
              setDraft(next);
              apply(next);
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "適用中…" : "この条件で絞り込む"}
        </button>
        {isDirty && (
          <span className="text-xs text-amber-700">未適用の変更があります</span>
        )}
        <Link href="/buildings" className="btn">
          条件をリセット
        </Link>
        <div className="ml-auto flex gap-2">
          <Link href="/import" className="btn">
            過去配布リスト取込
          </Link>
        </div>
      </div>
    </form>
  );
}
