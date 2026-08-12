-- ============================================================================
-- 住所の出所と粒度を記録する
--
-- OpenStreetMap の建物ポリゴンには住所タグがほとんど付いていないため、
-- 座標から「街区レベル位置参照情報（国土交通省）」で住所を補完する。
-- 補完した住所は住居番号を含まない（例: 荒川区東日暮里1-5）ため、
-- 取得元が最初から持っていた完全住所と区別できるようにする。
--
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて実行してください。
-- 0001 / 0002 を適用済みであることが前提です。
-- 既存データは削除・変更しません（既存行は NULL のままになります）。
-- ============================================================================

-- 住所の出所。'source' なら取得元が持っていた住所、'isj' なら位置参照情報で補完
alter table public.buildings
  add column if not exists address_source text;

-- 住所の粒度。'housenumber'（住居番号まで）/ 'block'（街区符号まで）/ 'town'（町丁目まで）
alter table public.buildings
  add column if not exists address_precision text;

comment on column public.buildings.address_source is
  '住所の出所。source=取得元が保持 / isj=街区レベル位置参照情報（国土交通省）で補完';
comment on column public.buildings.address_precision is
  '住所の粒度。housenumber=住居番号まで / block=街区符号まで / town=町丁目まで';

create index if not exists buildings_address_precision_idx
  on public.buildings (address_precision);

-- ---------------------------------------------------------------------------
-- 一覧ビューの作り直し
--
-- create or replace view は既存列の位置を変更できないため、
-- 列を追加したあとは drop → create で作り直す（42P16 の回避）。
-- ビューは定義だけでデータを持たないため、中身は失われない。
-- ---------------------------------------------------------------------------
drop view if exists public.building_list_view;

create view public.building_list_view
with (security_invoker = true) as
select
  b.*,
  (select count(*) from public.duplicate_candidates dc
    where dc.new_building_id = b.id and dc.status = 'pending') as pending_duplicate_count
from public.buildings b;

revoke all on public.building_list_view from anon;
