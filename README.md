# アパート・マンション配布対象リスト管理

対象エリアを選ぶとその区の建物一覧が表示され、過去にチラシを配布済みの建物を
自動で除外して、**まだ配布していない建物だけ**を一覧化する社内共同利用ツール。

- Next.js 16 (App Router) / TypeScript / Tailwind CSS v4
- Supabase (Postgres + Auth + Row Level Security)
- Vercel デプロイ前提

---

## ⚠️ 設置場所について

**このプロジェクトを iCloud Drive の同期対象（デスクトップ / 書類）に置かないでください。**

`node_modules` は数万ファイルあり頻繁に書き換わるため、クラウド同期と衝突して
ファイル欠落・`* 2` という競合ファイルの発生・ビルドのハングを引き起こします。

実際に Desktop 配下では `npm run build` が10分以上ハングしましたが、
`~/Developer/` へ移動したところ **1.9秒**で完了するようになりました。

現在の設置場所: `~/Developer/spider-wave-distribution-tool`

---

## 基本フロー

```
ログイン
  ↓
対象エリアを選択（東京都 → 荒川区）
  ↓
その区のアパート・マンション一覧を自動取得して表示
  ↓
過去配布リスト（CSV / Excel）を取込     ← 取込するのはこちらだけ
  ↓
住所を最優先に照合
  ↓
配布済み → 一覧から除外 ／ 怪しいもの → 重複候補へ隔離
  ↓
残った建物だけを「配布対象」として一覧表示
```

配布対象候補の建物一覧を CSV で取り込む機能はありません。
建物一覧はエリア選択に応じて建物データソースから取得します。

---

## セットアップ

### 1. Supabase プロジェクトを作成（要・あなたの操作）

supabase.com で新規プロジェクトを作成。リージョンは **Northeast Asia (Tokyo)** を推奨。

### 2. DB スキーマを適用（要・あなたの操作）

Supabase の **SQL Editor** で `supabase/migrations/0001_init.sql` を実行する。

| テーブル | 役割 |
|---|---|
| `buildings` | 建物マスタ。取得した建物も過去配布物件もすべて集約 |
| `distribution_history` | 配布実績。最終配布日・配布回数はここから自動算出 |
| `duplicate_candidates` | 重複候補と、人間が下した判断の記録 |
| `import_batches` | 過去配布リスト取込の履歴 |

RLS により、**未ログインユーザーは全テーブルを参照できない**。

### 3. 接続情報を設定

`.env.example` を `.env.local` にコピーし、Supabase の
**Project Settings > Data API / API Keys** から取得した値を記入する。

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # または eyJhbGciOi...（anon public）
```

`service_role` / `secret` キーは絶対に入れないこと（`NEXT_PUBLIC_` はブラウザに送信される）。

### 4. 社内メンバーを登録（要・あなたの操作）

Supabase の **Authentication > Users > Add user** でメールアドレスとパスワードを登録。
**Auto Confirm User をオン**にすること。サインアップ画面は意図的に用意していない。

### 5. 起動

```bash
npm install      # 初回のみ（package-lock.json から入れ直すなら npm ci）
npm run dev      # http://localhost:3000
npm test         # 住所正規化・重複判定・モックデータのユニットテスト
npm run build    # 本番ビルド
```

---

## 画面

| パス | 内容 |
|---|---|
| `/login` | メールアドレス + パスワードでログイン |
| `/buildings` | 建物一覧（エリア選択 / 件数 / 検索 / フィルタ / 並び替え / 配布済み一括登録） |
| `/duplicates` | 重複候補の確認（新規取得物件と過去配布候補を左右比較して振り分け） |
| `/import` | 過去配布リスト取込（列マッピング → プレビュー → 登録実行） |

一覧の初期表示は **配布対象のみ**。配布済み・重複候補は上部の件数カードから切り替える。

---

## 総世帯数（total_units）について

**自動取得は未実装。** 値が無い建物は `null` のままとし、画面には「不明」と表示する。
推測値は入れない。

そのため **「6世帯未満を自動除外」は現在無効**。実際の絞り込みは以下のとおり。

| total_units | 表示 |
|---|---|
| `null`（不明） | **表示する**（除外しない） |
| 6 以上 | 表示する |
| 1〜5 | 非表示 |

将来 total_units が取得できるようになれば、`lib/data-sources/unit-count/` に
`UnitCountProvider` を実装して registry に登録するだけでよい。
画面・フィルタ・重複判定の変更は不要。

世帯数での並び替え時、不明の物件は常に末尾に表示される。

---

## 重複判定の考え方

**最優先は住所。建物名だけで配布済みと判定しない。**

| ルール | 条件 | 判定 |
|---|---|---|
| 1 | `normalized_address` 完全一致 | `CONFIRMED_DISTRIBUTED`（配布対象から自動除外） |
| 2 | 住所が高類似 + 建物名も高類似 | `POSSIBLE_DUPLICATE`（一旦除外し確認画面へ） |
| 3 | 建物名だけ類似し、住所が明確に違う | `NOT_DISTRIBUTED`（配布対象として残す） |

ルール1では建物名が全く違っても住所一致を優先する。
逆にルール3では、同名の建物が別住所に存在しうるため名前の一致を根拠にしない。

**判定は安全側に倒す。** 「配布対象なのに一旦除外してしまう」ことより
「配布済みを見逃して二重配布する」ことを避ける。

取込の順序に依存しないよう、過去配布リストの取込後には
既に一覧に載っている建物との**逆向きの再照合**も走る
（`reconcileDistributionStatus`）。エリア取得を先に行っても配布済みは除外される。

### 住所正規化

```
東京都荒川区東日暮里1丁目5番3号 ／ 東京都荒川区東日暮里1-5-3
荒川区東日暮里１－５－３ ／ 荒川区 東日暮里 1-5-3 ／ 荒川区東日暮里一丁目五番三号
        ↓ すべて
荒川区東日暮里1-5-3
```

**元の `address` は絶対に書き換えず**、比較用の `normalized_address` を別に保存する。

### 建物名の表記ゆれ

カタカナ / ローマ字 / 英語 / 漢字を共通の canonical トークンへ寄せる。

```
グランドメゾン日暮里   → grand + maison + nippori
GRAND MAISON NIPPORI  → grand + maison + nippori
```

語彙は `lib/building-matching/dictionaries.ts` のデータファイル。
運用しながら語を追記するだけで精度が上がり、ロジック側の変更は不要。

---

## ディレクトリ構成

```
app/
  login/                    ログイン
  setup/                    Supabase 未設定時の案内
  (app)/buildings/          建物一覧（メイン）
  (app)/duplicates/         重複候補の確認
  (app)/import/             過去配布リスト取込
components/                 テーブル・フィルタ・エリア取得・ウィザード等の UI
lib/
  building-matching/        ★重複判定エンジン（UI から完全に独立）
    normalizeAddress.ts / normalizeBuildingName.ts
    calculateAddressSimilarity.ts / calculateNameSimilarity.ts
    matchBuilding.ts        判定エンジン
    transliterate.ts        カタカナ ⇄ ローマ字
    dictionaries.ts         語彙辞書（運用で育てるデータ）
    similarity.ts / geo.ts
  data-sources/             ★建物データ取得元（アプリ本体から分離）
    types.ts                共通インターフェース + 共通型 SourceBuilding
    index.ts                registry / BUILDING_DATA_SOURCE による選択
    mock-arakawa-source.ts  MockBuildingDataSource（開発確認用・荒川区）
    external-api-source.ts  ExternalApiBuildingDataSource（接続の雛形）
    unit-count/             ★総世帯数の取得（未実装・枠のみ）
    geocoding/              ★緯度経度の取得（未実装・枠のみ）
  buildings/                クエリ・Server Action・取込/取得パイプライン
  import/                   CSV パース・カラム推定
  supabase/                 クライアント / 型定義
supabase/migrations/        DB スキーマ
samples/                    動作確認用サンプル CSV
proxy.ts                    セッション更新と未ログイン遮断（Next 16 の proxy 規約）
```

判定ロジックは React コンポーネントに一切書かず、`lib/building-matching/` の
純粋関数として実装している。取得元も `lib/data-sources/` に分離してあるため、
データソースを差し替えても **配布履歴・重複判定・一覧表示・ログイン・Supabase** は
影響を受けない。

---

## 建物データの取得元

取得元は `BUILDING_DATA_SOURCE` で切り替える。

| 値 | 取得元 | 状態 |
|---|---|---|
| `mock` | 開発用モックデータ（荒川区16件） | 利用可能。開発環境の既定値 |
| `external_api` | 外部建物データ API | 接続先未設定 |

未指定時は **開発環境なら `mock`、本番環境なら `external_api`**。
**本番でモックへ自動フォールバックすることはない。**
選んだ取得元が使えない場合は、別の取得元へ勝手に切り替えず、画面に理由を表示する
（黙って別のデータを混ぜないため）。

モックデータは画面上部の警告帯と建物名横のバッジで「開発用データ」と明示される。
実在の物件情報ではない。

### 実データソースを接続する場所

`lib/data-sources/external-api-source.ts` の以下 3 点を提供元の仕様に合わせるだけでよい。
画面・重複判定・DB 同期・認証は一切変更不要。

| 関数 | 変えるところ |
|---|---|
| `buildRequest()` | パス・クエリ名・認証方式 |
| `toSourceBuilding()` | レスポンス 1 件 → 共通型 `SourceBuilding` の対応づけ |
| `listAreas()` | 提供元の対応エリア（API から取得してもよい） |

BASE URL / API キー / タイムアウト / HTTP エラー処理は実装済み。
**接続先が設定されるまでネットワークアクセスは一切行わない**
（`isAvailable()` が false のうちは `fetchByArea()` が即座に例外を投げる）。

```
BUILDING_DATA_SOURCE=external_api
BUILDING_API_BASE_URL=https://api.example.com
BUILDING_API_KEY=...              # 不要な提供元なら BUILDING_API_REQUIRES_KEY=false
BUILDING_API_TIMEOUT_MS=10000     # 任意・既定 10 秒
```

**不動産ポータルサイト（SUUMO / HOME'S / Yahoo!不動産 等）の無断スクレイピングは
実装していない。** 各サイトの利用規約で禁止されているため。自動取得を行う場合は
正式に契約した API、公的オープンデータ、自社保有データベースのいずれかを使うこと。

### 取得元が満たすインターフェース

```ts
interface BuildingDataSource {
  id, label, description
  isDevelopment          // true なら本番で自動選択されない
  supportsUnitCount      // 総世帯数を提供できるか
  supportsCoordinates    // 緯度経度を提供できるか
  isAvailable()          // 使えない理由を日本語で返す
  listAreas()            // 対応エリア
  fetchByArea(area)      // SourceBuilding[] を返す
}
```

取得元が返す共通型 `SourceBuilding` は
`source_ref` / `building_name` / `address` / `prefecture` / `city` / `town` /
`property_type` / `total_units` / `latitude` / `longitude` を持つ。
`total_units` / `latitude` / `longitude` は null 可で、**取得できない値は推測せず null**。

---

## 将来の配布ルール拡張

`distribution_history` に配布日を蓄積しているため、以下は日付条件の追加だけで実装できる。

- 90日以内に配布した物件だけ除外する
- 180日以上配布していない物件を再び配布候補に戻す

`buildings.last_distributed_date` / `distribution_count` はトリガで自動更新される。

---

## 未実装

- Excel（.xlsx）の直接取込 — 現在は CSV UTF-8 での書き出しが必要
- 総世帯数の自動取得 — 枠のみ用意済み（`lib/data-sources/unit-count/`）
- 緯度経度の自動付与（ジオコーディング）— DB・判定ロジック・UI は対応済みで、
  値を入れれば補助判定が自動的に効く
