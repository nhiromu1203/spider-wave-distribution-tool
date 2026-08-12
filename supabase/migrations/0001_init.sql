-- ============================================================================
-- アパート・マンション配布対象リスト管理ツール  初期スキーマ
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて実行してください。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------------
do $$ begin
  create type property_type as enum ('rental', 'condominium', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 物件の配布判定ステータス
  create type building_status as enum (
    'NOT_DISTRIBUTED',        -- 未配布
    'POSSIBLE_DUPLICATE',     -- 過去配布物件と同一の可能性あり（要確認）
    'CONFIRMED_DISTRIBUTED'   -- 配布済み確定
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- 重複候補に対する人間の判断結果
  create type duplicate_resolution as enum (
    'pending',    -- 未確認
    'same',       -- 同じ建物 → 配布済み扱い
    'different'   -- 別の建物 → 未配布扱い
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type building_source as enum ('manual', 'import', 'data_source');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- buildings : 建物マスタ
--   新規取得物件も過去配布物件もすべてこのテーブルに集約する。
--   address / building_name は「原本」であり、絶対に上書き・削除しない。
--   比較には normalized_* のみを使う。
-- ---------------------------------------------------------------------------
create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),

  -- 原本
  building_name text not null,
  address       text not null,

  -- 比較用（アプリ側 lib/building-matching で生成）
  normalized_building_name text not null default '',
  normalized_address       text not null default '',
  -- 住所の末尾に建物名・部屋番号が混入していた場合の残余（参考情報）
  address_extra text,

  -- エリア（検索・フィルタ用）
  prefecture text,
  city       text,
  town       text,

  -- 総世帯数。分からない場合は NULL（= 画面上「不明」。推測は行わない）
  total_units integer check (total_units is null or total_units >= 0),

  property_type property_type not null default 'unknown',

  -- 補助判定用。存在しなくても正常に動作する。
  latitude  double precision,
  longitude double precision,

  status building_status not null default 'NOT_DISTRIBUTED',

  -- distribution_history からトリガで自動更新される導出値
  last_distributed_date date,
  distribution_count    integer not null default 0,

  source     building_source not null default 'manual',
  source_ref text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.buildings.total_units is '総世帯数。不明な場合は NULL。推測値を入れてはならない。';
comment on column public.buildings.normalized_address is '重複判定の最優先キー。完全一致 = 同一物件とみなす。';

create index if not exists buildings_normalized_address_idx on public.buildings (normalized_address);
create index if not exists buildings_normalized_name_idx    on public.buildings (normalized_building_name);
create index if not exists buildings_area_idx               on public.buildings (prefecture, city, town);
create index if not exists buildings_status_idx             on public.buildings (status);
create index if not exists buildings_total_units_idx        on public.buildings (total_units);
create index if not exists buildings_last_distributed_idx   on public.buildings (last_distributed_date);
create index if not exists buildings_geo_idx                on public.buildings (latitude, longitude);

-- 同一住所・同一建物名の物件を二重登録しない（住所が空の場合は制約対象外）
create unique index if not exists buildings_unique_key_idx
  on public.buildings (normalized_address, normalized_building_name)
  where normalized_address <> '';


-- ---------------------------------------------------------------------------
-- distribution_history : 配布実績
--   1物件に複数件。最終配布日 / 配布回数はここから導出する。
--   「90日以内に配布した物件だけ除外」「180日以上配布していない物件を再候補に」
--   といったルールは、このテーブルへの日付条件だけで後から追加できる。
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_history (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  distributed_date date not null,
  distributed_by   text,
  notes            text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists distribution_history_building_idx on public.distribution_history (building_id);
create index if not exists distribution_history_date_idx     on public.distribution_history (distributed_date desc);


-- ---------------------------------------------------------------------------
-- duplicate_candidates : 重複候補
--   一度人間が判断した組み合わせは UNIQUE 制約で保持され、再確認は発生しない。
-- ---------------------------------------------------------------------------
create table if not exists public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  new_building_id               uuid not null references public.buildings(id) on delete cascade,
  possible_existing_building_id uuid not null references public.buildings(id) on delete cascade,

  address_similarity_score numeric(5,4) not null default 0,
  name_similarity_score    numeric(5,4) not null default 0,
  distance_meters          double precision,

  -- 判定理由（例: ["住所部分一致", "住所類似度 95%", "ローマ字/カタカナ類似"]）
  reason jsonb not null default '[]'::jsonb,

  status duplicate_resolution not null default 'pending',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint duplicate_candidates_not_self check (new_building_id <> possible_existing_building_id),
  constraint duplicate_candidates_unique_pair unique (new_building_id, possible_existing_building_id)
);

create index if not exists duplicate_candidates_status_idx on public.duplicate_candidates (status);
create index if not exists duplicate_candidates_new_idx    on public.duplicate_candidates (new_building_id);


-- ---------------------------------------------------------------------------
-- import_batches : CSV / Excel 取込履歴
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name    text not null,
  kind         text not null default 'distributed',  -- distributed | buildings
  total_rows   integer not null default 0,
  inserted_rows integer not null default 0,
  merged_rows   integer not null default 0,
  duplicate_rows integer not null default 0,
  skipped_rows  integer not null default 0,
  column_mapping jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- トリガ : updated_at 自動更新
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists buildings_set_updated_at on public.buildings;
create trigger buildings_set_updated_at
  before update on public.buildings
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- トリガ : 配布実績から last_distributed_date / distribution_count / status を再計算
-- ---------------------------------------------------------------------------
create or replace function public.refresh_building_distribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.building_id, old.building_id);
  cnt integer;
  last_date date;
begin
  select count(*), max(distributed_date)
    into cnt, last_date
    from public.distribution_history
   where building_id = target;

  update public.buildings b
     set distribution_count   = cnt,
         last_distributed_date = last_date,
         status = case
                    when cnt > 0 then 'CONFIRMED_DISTRIBUTED'::building_status
                    -- 配布実績が無くなった場合、未解決の重複候補が残っていれば
                    -- 未配布には戻さず POSSIBLE_DUPLICATE に留める（安全側）
                    when exists (
                      select 1 from public.duplicate_candidates dc
                       where dc.new_building_id = target and dc.status = 'pending'
                    ) then 'POSSIBLE_DUPLICATE'::building_status
                    else 'NOT_DISTRIBUTED'::building_status
                  end
   where b.id = target;

  return null;
end $$;

drop trigger if exists distribution_history_refresh on public.distribution_history;
create trigger distribution_history_refresh
  after insert or update or delete on public.distribution_history
  for each row execute function public.refresh_building_distribution();


-- ---------------------------------------------------------------------------
-- ビュー : 一覧表示用
-- ---------------------------------------------------------------------------
create or replace view public.building_list_view
with (security_invoker = true) as
select
  b.*,
  (select count(*) from public.duplicate_candidates dc
    where dc.new_building_id = b.id and dc.status = 'pending') as pending_duplicate_count
from public.buildings b;


-- ---------------------------------------------------------------------------
-- Row Level Security
--   未ログイン(anon)は一切参照できない。ログイン済(authenticated)のみ全操作可。
-- ---------------------------------------------------------------------------
alter table public.buildings            enable row level security;
alter table public.distribution_history enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.import_batches       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['buildings','distribution_history','duplicate_candidates','import_batches']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format($f$
      create policy %I on public.%I
        for all
        to authenticated
        using (true)
        with check (true)
    $f$, t || '_authenticated_all', t);
  end loop;
end $$;

revoke all on public.buildings, public.distribution_history,
               public.duplicate_candidates, public.import_batches
  from anon;
revoke all on public.building_list_view from anon;
