-- ============================================================================
-- 0008: 建物種別（マンション・アパート等）
--
-- property_type は所有形態（賃貸 / 分譲 / 不明）を表す列で、
-- 「マンションかアパートか」という建物の種別は保持していなかった。
-- AI 調査 CSV の building_type を受けるための列を足す。
--
-- ── 既存データを壊さないこと ────────────────────────────────
-- 列を1つ足すだけ。既存の行は NULL のまま（＝未設定）で、
-- 既存の値は一切変更しない。
--
-- 値は自由記述にしている。「マンション」「アパート」以外の書き方が
-- 出てきたときに、制約で取り込めなくなるのを避けるため。
-- ============================================================================

alter table public.buildings
  add column if not exists building_type text;

comment on column public.buildings.building_type is
  '建物種別（マンション・アパート等）。所有形態を表す property_type とは別。';

create index if not exists buildings_building_type_idx
  on public.buildings (building_type);

-- 確認
select
  coalesce(building_type, '(未設定)') as 建物種別,
  count(*) as 件数
from public.buildings
group by 1
order by 件数 desc;
