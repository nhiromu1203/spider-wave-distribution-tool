import { AiResearchCsvPanel } from "@/components/AiResearchCsvPanel";
import { BuildingCsvUploader } from "@/components/BuildingCsvUploader";
import { ImportWizard } from "@/components/ImportWizard";
import { DATA_SOURCES, resolveBuildingDataSource } from "@/lib/data-sources";
import { getDatasetDirectory, listDatasets } from "@/lib/data-sources/csv/store";
import { getActiveGeocodingProvider } from "@/lib/data-sources/geocoding";
import { getActiveUnitCountProvider } from "@/lib/data-sources/unit-count";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const unitCount = getActiveUnitCountProvider();
  const unitCountAvailability = unitCount.isAvailable();
  const geocoding = getActiveGeocodingProvider();
  const geocodingAvailability = geocoding.isAvailable();
  const resolution = resolveBuildingDataSource();
  const csvDatasets = await listDatasets();
  const csvDirectory = getDatasetDirectory();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold">過去配布リスト取込</h1>
        <p className="text-sm text-[var(--text-muted)]">
          過去にチラシを配布した物件の一覧を取り込みます。取り込んだ物件は住所を最優先に照合され、
          配布対象一覧から自動的に除外されます。アップロードした内容はすぐには登録されません。
          列の対応づけと判定結果を確認したうえで実行してください。
        </p>
      </header>

      <ImportWizard />

      <AiResearchCsvPanel />

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">建物一覧 CSV の登録</h2>
          <p className="text-sm text-[var(--text-muted)]">
            配布対象候補となる建物一覧を CSV で登録します。ここで登録したデータは
            <code> BUILDING_DATA_SOURCE=csv </code>
            のときに建物データ取得元として使われ、エリアを選ぶと自動で一覧に表示されます。
            過去配布リスト（上のセクション）とは別のデータです。
          </p>
        </div>

        <BuildingCsvUploader datasets={csvDatasets} />

        <p className="text-xs text-[var(--text-muted)]">
          保存先：<code>{csvDirectory}</code>
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">建物データの取得元</h2>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          配布対象候補の建物一覧は、この取込ではなく<strong>エリア選択に応じて自動取得</strong>されます。
          取得元はアプリ本体から分離してあり（<code>lib/data-sources/</code>）、
          差し替えても配布履歴・重複判定・一覧表示・ログインには影響しません。
        </p>
        <p className="mb-3 text-sm">
          現在の設定：<code>BUILDING_DATA_SOURCE={resolution.selectedId}</code>
          {resolution.mode === "default" && "（未指定のため既定値）"}
          {resolution.unavailableReason && (
            <span className="ml-2 text-amber-800">— 利用できません</span>
          )}
        </p>

        <ul className="space-y-2 text-sm">
          {DATA_SOURCES.map((source) => {
            const availability = source.isAvailable();
            const isActive = resolution.active?.id === source.id;
            return (
              <li
                key={source.id}
                className={`rounded border p-3 ${
                  isActive ? "border-[var(--accent)] bg-blue-50" : "border-[var(--border)]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{source.label}</strong>
                  <code className="text-xs text-[var(--text-muted)]">{source.id}</code>
                  {isActive && (
                    <span className="badge bg-[var(--accent)] text-white">使用中</span>
                  )}
                  <span
                    className={`badge ${
                      availability.available
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {availability.available ? "利用可能" : "未設定"}
                  </span>
                  {source.isDevelopment && (
                    <span className="badge border border-amber-300 bg-amber-50 text-amber-800">
                      開発用データ
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[var(--text-muted)]">{source.description}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  総世帯数：{source.supportsUnitCount ? "提供あり" : "提供なし（不明のまま）"}
                  ／ 緯度経度：
                  {source.supportsCoordinates ? "提供あり" : "提供なし（null のまま）"}
                </p>
                {!availability.available && (
                  <p className="mt-1 text-xs text-amber-800">{availability.reason}</p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          不動産ポータルサイトの無断スクレイピングは実装していません。各サイトの利用規約で禁止されているため、
          自動取得を行う場合は正式に契約した API または公的オープンデータをご利用ください。
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">総世帯数の取得元</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {unitCountAvailability.available
            ? `${unitCount.label} から自動取得します。`
            : unitCountAvailability.reason}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          取得ロジックは <code>lib/data-sources/unit-count/</code> に分離してあります。
          外部 API・オープンデータ・建物データ提供サービスが決まったら、
          <code>UnitCountProvider</code> を実装して registry に登録するだけで、
          画面やフィルタを変更せずに総世帯数が入ります。
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">緯度経度の取得元</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {geocodingAvailability.available
            ? `${geocoding.label} から自動取得します。`
            : geocodingAvailability.reason}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          取得ロジックは <code>lib/data-sources/geocoding/</code> に分離してあります。
          <code>GeocodingProvider</code> を実装して registry に登録すると、
          「住所表記が違っても座標が近い」ケースを重複候補として拾えるようになります。
        </p>
      </section>
    </div>
  );
}
