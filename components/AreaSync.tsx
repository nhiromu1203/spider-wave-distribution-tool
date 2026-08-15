/**
 * 選択中のエリアを示す帯。
 *
 * ── 取得機能を外した経緯 ────────────────────────────────────
 * 以前はここに「建物データを取得」する処理があり、しかも
 * 「取り込み済みが 0 件なら自動で取得する」作りだった。
 *
 * 建物マスタを CSV（source='import'）で作り直すと、取得元由来
 * （source='data_source'）は常に 0 件になる。その結果、画面を開く
 * たびに OSM から取得して登録され、736 件が 1,108 件へ増え続けた。
 *
 * 建物マスタの正は AI 調査 CSV 取込に一本化したため、取得の経路を
 * 丸ごと外した。この部品はもう DB を変更しない。
 * ────────────────────────────────────────────────────────────
 */
export function AreaSync({
  prefecture,
  city,
  town,
}: {
  prefecture: string | null;
  city: string | null;
  town: string | null;
}) {
  if (!prefecture || !city) {
    return (
      <div className="card border-[var(--accent)] bg-blue-50 p-3 text-sm">
        上の <strong>対象エリア</strong> から都道府県と市区町村を選択してください。
        選択した区の建物一覧が表示されます。
      </div>
    );
  }

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
      <span>
        対象エリア：<strong>
          {prefecture} {city}
        </strong>
        {town && ` ${town}`}
      </span>

      <span className="text-xs text-[var(--text-muted)]">
        建物マスタは「取込」画面の AI 調査 CSV 取込で管理します。
        この画面から建物が追加されることはありません。
      </span>
    </div>
  );
}
