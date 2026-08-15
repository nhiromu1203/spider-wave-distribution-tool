-- ============================================================================
-- 0007: AI 調査 CSV の取込履歴
--
-- 建物情報（建物名・住所・総世帯数・物件種別）を CSV で補完したとき、
-- 何をどう変えたのかを項目単位で残し、取込単位で元に戻せるようにする。
--
-- ── 既存データを壊さないこと ────────────────────────────────
-- 表を2つ作るだけ。既存の列も行も変更しない。
-- 配布実績・状態・重複候補には一切関与しない。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 取込のまとまり。ロールバックの単位になる
-- ---------------------------------------------------------------------------
create table if not exists public.ai_csv_batches (
  id           uuid primary key default gen_random_uuid(),
  file_name    text,
  source       text,
  note         text,
  row_count    integer not null default 0,
  applied_count integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  -- 取り消し済みかどうか
  rolled_back_at timestamptz
);

create index if not exists ai_csv_batches_created_idx
  on public.ai_csv_batches (created_at desc);

comment on table public.ai_csv_batches is
  'AI 調査 CSV の取込単位。この単位で建物情報の変更を元に戻せる。';

-- ---------------------------------------------------------------------------
-- 項目ごとの変更履歴
--
-- 建物情報の列だけを対象にする。status や配布実績は記録対象にしない
-- （そもそも変更しないため）。
-- ---------------------------------------------------------------------------
create table if not exists public.building_field_updates (
  id          bigserial primary key,
  batch_id    uuid not null references public.ai_csv_batches(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  -- building_name / address / total_units / property_type のいずれか
  field_name  text not null,
  old_value   text,
  new_value   text,
  source      text,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),

  constraint building_field_updates_field_allowed check (
    field_name in ('building_name', 'address', 'total_units', 'property_type')
  )
);

create index if not exists building_field_updates_batch_idx
  on public.building_field_updates (batch_id);

create index if not exists building_field_updates_building_idx
  on public.building_field_updates (building_id, updated_at desc);

comment on table public.building_field_updates is
  'AI 調査 CSV による建物情報の変更履歴。列は建物情報の4項目に限定している。';

-- ---------------------------------------------------------------------------
-- RLS。ログイン済みの社内メンバーのみ
-- ---------------------------------------------------------------------------
alter table public.ai_csv_batches         enable row level security;
alter table public.building_field_updates enable row level security;

drop policy if exists ai_csv_batches_authenticated_all on public.ai_csv_batches;
create policy ai_csv_batches_authenticated_all on public.ai_csv_batches
  for all to authenticated using (true) with check (true);

drop policy if exists building_field_updates_authenticated_all
  on public.building_field_updates;
create policy building_field_updates_authenticated_all
  on public.building_field_updates
  for all to authenticated using (true) with check (true);

revoke all on public.ai_csv_batches         from anon;
revoke all on public.building_field_updates from anon;

-- 確認
select
  (select count(*) from public.ai_csv_batches)         as 取込回数,
  (select count(*) from public.building_field_updates) as 変更項目数;
