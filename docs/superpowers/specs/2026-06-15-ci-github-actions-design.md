# GitHub Actions CI（Q1）設計

> 作成日: 2026-06-15 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.4.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（Q1, §6）

## 1. 背景と問題

現状リポジトリには **CI が一切ない**（`.github/` ディレクトリが存在しない）。型チェック・テスト・ビルドはローカル手動実行に依存しており、壊れた変更を PR 時点で弾く仕組みがない。

とりわけ重要なのは、**MySQL を要する統合・スキーマテストが常に skip されている**点。以下2ファイルは `TEST_MYSQL_HOST` 環境変数が無いと `describe.skipIf(!hasDb)` で丸ごとスキップされる:

- `src/main/connection/ConnectionManager.integration.test.ts`
- `src/main/connection/ConnectionManager.schema.test.ts`

両ファイルとも env から接続情報を読み、未設定時は host のみ判定して skip する（デフォルト: port `13306` / user `root` / password `rootpw` / database `testdb`）。CI で MySQL を立てて env を渡せば、この退行検知価値の高いテスト群が常時実行に転換する。これが Q1 の主目的。

## 2. ゴール / 非ゴール

### ゴール
- `push`（main）と `pull_request`（main 宛）で typecheck・test・build を自動実行する CI を新設する。
- CI 上で MySQL 8.0 を起動し、現在 skip されている統合・スキーマテストを**常時実行**に転換する。
- 失敗箇所が一目で分かるジョブ構成にする。

### 非ゴール
- **Q2 Biome（lint/format）** … v0.4 では見送りバッチ。本 CI は後で `lint` ジョブを足せる構造にとどめる（今回は追加しない）。
- **Q4 署名 / notarization / DMG パッケージング / Release ワークフロー** … Tier 3。`electron-builder`（`dist:mac`）は CI で回さない。
- **ブランチ保護（required status checks 化）** … リポジトリ管理設定であり、ワークフローのコードではない。手順は §6 に注記するが、実設定は手動操作。
- **macOS ランナーでのビルド検証** … 署名・パッケージングをやらない以上、ロジック検証は ubuntu で十分。将来 Q4 着手時に matrix 化を検討。

## 3. 設計

新規ファイル1つ: `.github/workflows/ci.yml`

### 3.1 トリガと並行制御

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- `pull_request` は main 宛の PR すべてが対象。
- `concurrency` で同一 ref の古い実行を自動キャンセルし、ランナー消費を抑える。

### 3.2 共通のベース環境

- ランナー: **`ubuntu-latest`**。`mysql2` / `ssh2` とも pure-JS で OS 非依存のため、ロジック検証は ubuntu で十分かつ高速・低コスト。
- Node: **22**（ローカル `v22.17.0` に整合）。`actions/setup-node@v4` で `node-version: 22` + `cache: npm`。
- 依存インストール: **`npm ci`**（`package-lock.json` 厳密インストール）。各ジョブ冒頭で実行。

### 3.3 ジョブ構成 — 3並列

直列1ジョブだと typecheck 失敗時に test/build が回らず原因切り分けが遅い。**並列3ジョブ**で失敗箇所を明確化し、フィードバックを速くする。

| ジョブ | ステップ |
|---|---|
| `typecheck` | checkout → setup-node(cache) → `npm ci` → `npm run typecheck` |
| `test` | checkout → setup-node(cache) → `npm ci` → `npm run test`（MySQL service + env、§3.4） |
| `build` | checkout → setup-node(cache) → `npm ci` → `npm run build` |

- `typecheck` = `tsc --noEmit`（node/web の2プロジェクト、既存 npm script）。
- `build` = `electron-vite build` のみ（既存 `build` script）。**`electron-builder` / DMG は回さない**（非ゴール）。

### 3.4 `test` ジョブの MySQL 供給

GitHub Actions の **`services:` ブロック**で `mysql:8.0` を起動する（GH Actions ネイティブ・health check が簡潔。ローカル用 `docker-compose.test.yml` は別物として残す）。

```yaml
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: rootpw
          MYSQL_DATABASE: testdb
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h 127.0.0.1 -prootpw"
          --health-interval=3s
          --health-timeout=5s
          --health-retries=20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run test
        env:
          TEST_MYSQL_HOST: 127.0.0.1
          TEST_MYSQL_PORT: 3306
          TEST_MYSQL_USER: root
          TEST_MYSQL_PASSWORD: rootpw
          TEST_MYSQL_DATABASE: testdb
```

- テスト側デフォルトの port `13306` と CI の `3306` の差は env `TEST_MYSQL_PORT` 上書きで吸収する（テストコードの変更不要）。
- `TEST_MYSQL_HOST` を設定することで `skipIf(!hasDb)` が false になり、統合・スキーマテストが実行される。

### 3.5 想定挙動の確認ポイント

- MySQL コンテナの ready 待ちは `services.options` の health check に委ねる（GH Actions はサービスが healthy になるまでジョブステップを開始しない）。アプリ側の追加待機ロジックは不要。
- `mysql:8.0` の `caching_sha2_password` 認証は `mysql2` が対応済み（ローカル compose と同イメージのため挙動一致）。

## 4. テスト / 検証

CI 自体の検証は「ワークフローが緑になること」で行う。具体的には:

- PR を出した時点で `typecheck` / `test` / `build` の3チェックが走る。
- `test` ジョブのログに、これまで skip されていた `ConnectionManager (integration)` / `ConnectionManager.tableSchema (integration)` の各 it が **実行（pass）** として現れることを確認（skip→run への転換が Q1 のゴールそのもの）。
- 故意に型エラー / 失敗テストを混ぜた検証ブランチで、該当ジョブが**赤くなる**ことを1度確認するのが望ましい（実装計画側のタスクに含める）。

## 5. リスクと緩和

- **`services` の MySQL 起動が遅い / flaky** → health check retries を 20 と十分に確保（ローカル compose と同値）。必要なら interval/timeout を調整。
- **`npm ci` が遅い** → `actions/setup-node` の `cache: npm` で `~/.npm` をキャッシュし短縮。
- **ubuntu と本番(macOS)の差異でビルドが通っても実機で壊れる** → 本 CI はロジック/ビルド成立の検証が目的。実機 GUI 検証は従来どおり手動（メモリ `v0-2-0-plan` の積み残し）。署名込み macOS ビルドは Q4 で別途。

## 6. フォローアップ（spec スコープ外・手動 or 別バッチ）

- **ブランチ保護**: ワークフロー初回グリーン後、GitHub の Settings → Branches で `typecheck` / `test` / `build` を main の required status checks に設定（手動操作）。
- **Q2 Biome**: 別バッチで `lint` ジョブを追加。
- **Q4 Release CI**: 署名・notarization・DMG 添付は Tier 3 で別 spec。
