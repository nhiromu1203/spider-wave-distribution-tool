-- ============================================================================
-- 0006: 建物名の更新履歴
--
-- 補完 CSV で建物名を書き換えたとき、誰がどの CSV で何を変えたのかを残す。
--
-- ── 既存データを壊さないこと ────────────────────────────────
-- 表を1つ作るだけ。既存の列も行も変更しない。
-- ============================================================================

create table if not exists public.building_name_updates (
  id                bigserial primary key,
  building_id       uuid not null references public.buildings(id) on delete cascade,
  old_building_name text,
  new_building_name text not null,
  -- CSV の source 列。どのサイト・手段で調べたか
  source            text,
  -- CSV の status 列（CONFIRMED / HIGH）
  status            text not null,
  note              text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);

create index if not exists building_name_updates_building_idx
  on public.building_name_updates (building_id, updated_at desc);

create index if not exists building_name_updates_updated_at_idx
  on public.building_name_updates (updated_at desc);

comment on table public.building_name_updates is
  '建物名を CSV 取込で更新した履歴。いつ誰がどの根拠で変えたかを追える。';

alter table public.building_name_updates enable row level security;

drop policy if exists building_name_updates_authenticated_all
  on public.building_name_updates;
create policy building_name_updates_authenticated_all
  on public.building_name_updates
  for all to authenticated using (true) with check (true);

revoke all on public.building_name_updates from anon;

-- 確認
select count(*) as 履歴件数 from public.building_name_updates;
