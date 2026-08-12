-- ============================================================================
-- 0004: 開発用モックデータの削除
--
-- 対象は source_ref が 'mock-arakawa:' で始まる 14 件。
-- lib/data-sources/mock-arakawa-source.ts が生成した開発確認用データで、
-- 実在の建物ではない（定義 16 件のうち 2 件は住所一致で未登録のため 14 件）。
--
-- ── この migration の性質 ──────────────────────────────────
-- ・一度だけ実行される  … schema_migrations に記録し、2 回目以降は何もしない
-- ・ロールバック可能    … 削除する行を data_archive へ退避してから消す
-- ・原子的             … 全体が 1 つの DO ブロックで、途中で失敗すれば巻き戻る
--
-- ── 触らないもの ────────────────────────────────────────────
-- OSM 由来（osm:…）／CSV 由来（csv:…）／過去配布リスト（source_ref が NULL）
-- 配布実績がある行（distribution_count > 0）も対象外にする
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 適用済み migration の記録先
-- ---------------------------------------------------------------------------
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now(),
  note       text
);

alter table public.schema_migrations enable row level security;

drop policy if exists schema_migrations_authenticated_read on public.schema_migrations;
create policy schema_migrations_authenticated_read on public.schema_migrations
  for select to authenticated using (true);

revoke all on public.schema_migrations from anon;

-- ---------------------------------------------------------------------------
-- 削除した行の退避先（ロールバック用）
--
-- 行全体を jsonb で持つ。列構成が変わっても退避・復元ができる。
-- ---------------------------------------------------------------------------
create table if not exists public.data_archive (
  id                bigserial primary key,
  migration_version text not null,
  table_name        text not null,
  row_data          jsonb not null,
  archived_at       timestamptz not null default now()
);

create index if not exists data_archive_version_idx
  on public.data_archive (migration_version, table_name);

alter table public.data_archive enable row level security;

drop policy if exists data_archive_authenticated_read on public.data_archive;
create policy data_archive_authenticated_read on public.data_archive
  for select to authenticated using (true);

revoke all on public.data_archive from anon;

comment on table public.data_archive is
  'migration で削除した行の退避先。ロールバック時にここから復元する。';

-- ---------------------------------------------------------------------------
-- 本体
-- ---------------------------------------------------------------------------
do $$
declare
  v_version   constant text := '0004_remove_dev_mock_data';
  v_pattern   constant text := 'mock-arakawa:%';
  v_buildings  integer;
  v_candidates integer;
  v_history    integer;
  v_repaired   integer;
  v_protected  integer;
begin
  -- 二重実行の防止
  if exists (select 1 from public.schema_migrations where version = v_version) then
    raise notice '[%] は適用済みのため何もしません。', v_version;
    return;
  end if;

  -- 配布実績がある行は削除対象から外す（実際に配布した記録は消さない）
  select count(*) into v_protected
    from public.buildings
   where source_ref like v_pattern
     and distribution_count > 0;

  if v_protected > 0 then
    raise notice '配布実績があるため保護した開発用データ: % 件', v_protected;
  end if;

  -- ── 退避（ロールバック用）────────────────────────────────
  -- 子テーブルを先に退避する。buildings を消すと cascade で消えるため。
  insert into public.data_archive (migration_version, table_name, row_data)
  select v_version, 'duplicate_candidates', to_jsonb(dc)
    from public.duplicate_candidates dc
   where dc.new_building_id in (
           select id from public.buildings
            where source_ref like v_pattern and distribution_count = 0)
      or dc.possible_existing_building_id in (
           select id from public.buildings
            where source_ref like v_pattern and distribution_count = 0);
  get diagnostics v_candidates = row_count;

  insert into public.data_archive (migration_version, table_name, row_data)
  select v_version, 'distribution_history', to_jsonb(dh)
    from public.distribution_history dh
   where dh.building_id in (
           select id from public.buildings
            where source_ref like v_pattern and distribution_count = 0);
  get diagnostics v_history = row_count;

  insert into public.data_archive (migration_version, table_name, row_data)
  select v_version, 'buildings', to_jsonb(b)
    from public.buildings b
   where b.source_ref like v_pattern
     and b.distribution_count = 0;
  get diagnostics v_buildings = row_count;

  -- ── 削除 ──────────────────────────────────────────────────
  delete from public.buildings
   where source_ref like v_pattern
     and distribution_count = 0;

  -- ── 取り残しの修復 ────────────────────────────────────────
  -- 削除した建物が「重複候補の相手」だった場合、cascade で候補ごと消える。
  -- 相手の建物が POSSIBLE_DUPLICATE のまま確認待ち 0 件で取り残されるため、
  -- 配布実績が無いものを配布対象へ戻す。
  update public.buildings b
     set status = 'NOT_DISTRIBUTED'
   where b.status = 'POSSIBLE_DUPLICATE'
     and b.distribution_count = 0
     and not exists (
       select 1 from public.duplicate_candidates dc
        where dc.new_building_id = b.id and dc.status = 'pending');
  get diagnostics v_repaired = row_count;

  insert into public.schema_migrations (version, note)
  values (
    v_version,
    format('建物 %s 件 / 重複候補 %s 件 / 配布履歴 %s 件を退避して削除。状態修復 %s 件。保護 %s 件。',
           v_buildings, v_candidates, v_history, v_repaired, v_protected)
  );

  raise notice '削除した建物: % 件', v_buildings;
  raise notice '一緒に消えた重複候補: % 件', v_candidates;
  raise notice '一緒に消えた配布履歴: % 件', v_history;
  raise notice '状態を配布対象へ戻した建物: % 件', v_repaired;
end $$;

-- ---------------------------------------------------------------------------
-- 適用結果の確認
-- ---------------------------------------------------------------------------
select version, applied_at, note from public.schema_migrations
where version = '0004_remove_dev_mock_data';

select
  case
    when source_ref like 'osm:%'          then 'OSM'
    when source_ref like 'mock-arakawa:%' then '開発用モック（残存＝異常）'
    when source_ref like 'mock:%'         then '開発用モック新形式（残存＝異常）'
    when source_ref like 'csv:%'          then 'CSV'
    when source_ref is null               then '手入力・過去配布リスト'
    else 'その他'
  end      as 由来,
  status   as ステータス,
  count(*) as 件数
from public.buildings
where city = '荒川区'
group by 1, 2
order by 1, 2;

select status as ステータス, count(*) as 件数
from public.buildings
where city = '荒川区'
group by status
order by 件数 desc;
