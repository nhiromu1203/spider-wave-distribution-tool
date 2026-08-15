-- ============================================================================
-- 0005: 建物名の補完
--
-- ・自動採用した建物名と、人が入力した建物名を区別して残す
-- ・一度調べた街区は二度調べない（外部サイトへの再問い合わせを避ける）
--
-- ── 既存データを壊さないこと ────────────────────────────────
-- 列の追加と新しい表の作成だけを行う。
-- 既存行の building_name は書き換えない。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 建物名の出所
--
--   manual … 人が入力した。何があっても上書きしない
--   auto   … 照合で自動採用した（判定 HIGH のみ）
--   source … 取得元（OSM 等）に元から付いていた
-- ---------------------------------------------------------------------------
alter table public.buildings
  add column if not exists name_source text;

alter table public.buildings
  add column if not exists name_decided_at timestamptz;

comment on column public.buildings.name_source is
  '建物名の出所。manual は人の入力で、自動処理では決して上書きしない。';

create index if not exists buildings_name_source_idx
  on public.buildings (name_source);

-- ---------------------------------------------------------------------------
-- 街区ごとの調査記録
--
-- 同じ街区を何度も外部サイトへ問い合わせないための記録。
-- 候補そのものも残すので、あとから判定基準だけを見直せる。
-- ---------------------------------------------------------------------------
create table if not exists public.building_name_lookups (
  id           bigserial primary key,
  -- 「東日暮里/4/32」のような街区の識別子
  block_key    text not null,
  prefecture   text not null,
  city         text not null,
  source       text not null,
  -- 取得できた候補（建物名・所在地・座標）
  candidates   jsonb not null default '[]'::jsonb,
  candidate_count integer not null default 0,
  looked_up_at timestamptz not null default now(),
  unique (block_key, source)
);

create index if not exists building_name_lookups_area_idx
  on public.building_name_lookups (prefecture, city);

comment on table public.building_name_lookups is
  '街区ごとの建物名調査の記録。ここに行があれば外部サイトへは問い合わせない。';

alter table public.building_name_lookups enable row level security;

drop policy if exists building_name_lookups_authenticated_all
  on public.building_name_lookups;
create policy building_name_lookups_authenticated_all
  on public.building_name_lookups
  for all to authenticated using (true) with check (true);

revoke all on public.building_name_lookups from anon;

-- ---------------------------------------------------------------------------
-- 既存データの扱い
--
-- すでに建物名が入っている行は、出所が分からないため manual として扱う。
-- 自動処理に上書きされないほうが安全なため、保護側に倒す。
-- 建物名そのものは一切変更しない。
-- ---------------------------------------------------------------------------
update public.buildings
   set name_source = 'manual'
 where name_source is null
   and building_name is not null
   and btrim(building_name) <> ''
   and building_name <> '（建物名不明）';

-- 確認
select
  coalesce(name_source, '(未設定)') as 建物名の出所,
  count(*) as 件数
from public.buildings
group by 1
order by 件数 desc;
