-- ============================================================================
-- 建物用途による配布対象の絞り込み
--
-- 配布対象は「住居用途の集合住宅（マンション・アパート・集合住宅）」のみ。
-- 戸建て・店舗・オフィス・工場・学校・病院・倉庫・商業施設は登録しない。
-- 判定できなかった建物は除外せず「要確認」として残す。
--
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて実行してください。
-- 0001_init.sql を適用済みであることが前提です。
-- 既存データは削除・変更しません（既存行は「要確認」になります）。
-- ============================================================================

do $$ begin
  create type building_use as enum (
    'RESIDENTIAL_MULTI',  -- 集合住宅。配布対象
    'EXCLUDED',           -- 対象外（戸建て・店舗・オフィス等）
    'NEEDS_REVIEW'        -- 要確認。判定できなかった建物
  );
exception when duplicate_object then null; end $$;

-- 既存行は用途が未判定のため、既定値を「要確認」にする。
-- 勝手に配布対象とみなすと、店舗や戸建てへ配布してしまうおそれがあるため。
alter table public.buildings
  add column if not exists building_use building_use not null default 'NEEDS_REVIEW';

-- 判定理由（画面で「なぜ要確認なのか」を示すために使う）
alter table public.buildings
  add column if not exists building_use_note text;

comment on column public.buildings.building_use is
  '建物用途の判定結果。配布対象は RESIDENTIAL_MULTI のみ。判定できないものは NEEDS_REVIEW として残す。';
comment on column public.buildings.building_use_note is
  '判定理由。OSM の building タグ値や、判定に使った語を記録する。';

create index if not exists buildings_building_use_idx
  on public.buildings (building_use);

-- ---------------------------------------------------------------------------
-- 一覧ビューを作り直して building_use を含める
--
-- create or replace view は既存列の名前・位置を変更できない。
-- buildings に列を追加したことで b.* の展開が伸び、pending_duplicate_count の
-- 位置がずれるため replace では失敗する（42P16）。
-- そのため一度削除してから作り直す。
--
-- ビューは定義だけの存在でデータを持たないため、削除しても
-- buildings / distribution_history / duplicate_candidates の中身は失われない。
-- ---------------------------------------------------------------------------
drop view if exists public.building_list_view;

create view public.building_list_view
with (security_invoker = true) as
select
  b.*,
  (select count(*) from public.duplicate_candidates dc
    where dc.new_building_id = b.id and dc.status = 'pending') as pending_duplicate_count
from public.buildings b;

-- ビューを作り直すと権限も初期化されるため、未ログイン(anon)の遮断を再適用する
revoke all on public.building_list_view from anon;
