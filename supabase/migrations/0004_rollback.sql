-- ============================================================================
-- 0004 のロールバック
--
-- 0004_remove_dev_mock_data.sql で削除した開発用モックデータを、
-- data_archive から元に戻す。
--
-- ── 復元される順序 ──────────────────────────────────────────
-- 1. buildings              （親。先に戻さないと外部キーが通らない）
-- 2. distribution_history   （子）
-- 3. duplicate_candidates   （子）
--
-- ── 復元できない場合 ────────────────────────────────────────
-- 削除後に別の建物が同じ (normalized_address, normalized_building_name) を
-- 使い始めていると、一意制約に触れて復元できない。
-- その場合は復元をあきらめ、開発用データは消えたままにするのが安全。
-- ============================================================================

do $$
declare
  v_version constant text := '0004_remove_dev_mock_data';
  v_buildings  integer;
  v_history    integer;
  v_candidates integer;
begin
  if not exists (select 1 from public.schema_migrations where version = v_version) then
    raise notice '[%] は適用されていないため、戻すものがありません。', v_version;
    return;
  end if;

  -- 1. 建物を戻す
  -- on conflict do nothing は id だけでなく
  -- (normalized_address, normalized_building_name) の一意制約にも効く。
  -- 削除後に別の建物が同じキーを使い始めていた場合は、その行だけ戻さない。
  insert into public.buildings
  select (jsonb_populate_record(null::public.buildings, row_data)).*
    from public.data_archive
   where migration_version = v_version and table_name = 'buildings'
  on conflict do nothing;
  get diagnostics v_buildings = row_count;

  -- 2. 配布履歴を戻す
  insert into public.distribution_history
  select (jsonb_populate_record(null::public.distribution_history, row_data)).*
    from public.data_archive
   where migration_version = v_version and table_name = 'distribution_history'
  on conflict do nothing;
  get diagnostics v_history = row_count;

  -- 3. 重複候補を戻す
  insert into public.duplicate_candidates
  select (jsonb_populate_record(null::public.duplicate_candidates, row_data)).*
    from public.data_archive
   where migration_version = v_version and table_name = 'duplicate_candidates'
  on conflict do nothing;
  get diagnostics v_candidates = row_count;

  -- 戻した重複候補に確認待ちがあれば、建物の状態も戻す
  update public.buildings b
     set status = 'POSSIBLE_DUPLICATE'
   where b.distribution_count = 0
     and b.status = 'NOT_DISTRIBUTED'
     and exists (
       select 1 from public.duplicate_candidates dc
        where dc.new_building_id = b.id and dc.status = 'pending');

  -- 適用記録と退避データを片付ける（再度 migration を流せる状態に戻す）
  delete from public.schema_migrations where version = v_version;
  delete from public.data_archive where migration_version = v_version;

  raise notice '戻した建物: % 件', v_buildings;
  raise notice '戻した配布履歴: % 件', v_history;
  raise notice '戻した重複候補: % 件', v_candidates;
end $$;

-- 確認
select status as ステータス, count(*) as 件数
from public.buildings
where city = '荒川区'
group by status
order by 件数 desc;
