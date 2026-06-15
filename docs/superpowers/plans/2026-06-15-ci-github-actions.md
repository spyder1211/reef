# GitHub Actions CI（Q1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** push(main) / PR(main宛) で typecheck・test・build を3並列実行し、MySQL を要する統合・スキーマテストを skip→常時実行へ転換する CI を新設する。

**Architecture:** `.github/workflows/ci.yml` を1ファイル新設。ubuntu-latest / Node 22 / `npm ci`。`test` ジョブのみ `services:` で MySQL 8.0 を起動し、env（`TEST_MYSQL_*`）でテストコードへ接続情報を注入（テストコードは無改修）。CI 検証は GH Actions 上で緑になることで行うため、ローカルでは「YAML 構文の妥当性」と「CI と同条件（MySQL ready + env）での test 通過」を事前確認する。

**Tech Stack:** GitHub Actions / `actions/checkout@v4` / `actions/setup-node@v4` / `services.mysql (mysql:8.0)` / 既存 npm scripts（typecheck・test・build）/ vitest。

**Spec:** `docs/superpowers/specs/2026-06-15-ci-github-actions-design.md`

**前提:** ブランチ `feat/ci-github-actions` で作業中（spec コミット済み）。リポジトリは `package-lock.json`（npm）、Node ローカル v22.17.0、`docker-compose.test.yml`（mysql:8.0, host port 13306）が存在。

---

## Task 1: CI と同条件でローカル test 通過を事前確認（ベースライン取得）

CI を書く前に「MySQL ready + `TEST_MYSQL_*` env を渡せば統合・スキーマテストが skip されず通る」ことをローカルで確認し、CI 失敗時の切り分け基準を作る。コード変更なし・検証のみ。

**Files:**
- 変更なし（検証のみ）。参照: `docker-compose.test.yml`, `src/main/connection/ConnectionManager.integration.test.ts`, `src/main/connection/ConnectionManager.schema.test.ts`

- [ ] **Step 1: ローカル MySQL を起動**

Run: `docker compose -f docker-compose.test.yml up -d`
Expected: `mysql` コンテナが起動。`docker compose -f docker-compose.test.yml ps` で healthy になるまで数秒待つ。

- [ ] **Step 2: env を渡さず test 実行 → 統合テストが skip されることを確認**

Run: `npm run test 2>&1 | grep -iE 'integration|skip' | head`
Expected: `ConnectionManager (integration)` / `ConnectionManager.tableSchema (integration)` が skip 表示（`hasDb` false のため）。全体は PASS。

- [ ] **Step 3: env を渡して test 実行 → 統合テストが実行されることを確認**

Run:
```bash
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root \
TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb npm run test
```
Expected: 全テスト PASS。`ConnectionManager (integration)` と `ConnectionManager.tableSchema (integration)` の各 it が **実行（skip されない）**。「これが CI で再現できれば成功」というベースラインが取れた状態。

- [ ] **Step 4: ローカル MySQL を停止（任意・後片付け）**

Run: `docker compose -f docker-compose.test.yml down`
Expected: コンテナ停止。

> このタスクはコミット不要（検証のみ）。CI の env / port（CI は 3306）はこの後 Task 2 で設定する。port 差（ローカル 13306 ↔ CI 3306）は env で吸収される設計。

---

## Task 2: `.github/workflows/ci.yml` を作成

3並列ジョブ（typecheck / test / build）の CI ワークフローを新規作成する。

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: ワークフローファイルを作成**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck

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

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 2: YAML 構文の妥当性をローカル検証**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');console.log('lines:',s.split('\n').length);process.exit(s.includes('\t')?1:0)" && echo "no-tabs OK"`
Expected: `lines: ...` と `no-tabs OK`（YAML はタブ禁止。インデントがスペースであることを確認）。

> 補足: `js-yaml` 等が無くても上記でタブ混入は弾ける。より厳密に確認したい場合は `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('valid yaml')"`（python が利用可能なら）。

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions で typecheck/test/build を3並列実行

MySQL 8.0 を services で起動し統合・スキーマテストを常時実行へ転換。
ubuntu-latest / Node 22 / npm ci + cache。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PR を作成し CI を実環境で緑にする（最終検証）

ワークフローは GitHub 上でしか実行できないため、PR を出して実際に走らせ、3チェックの緑化と「統合テストが skip→run になった」ことをログで確認する。

**Files:**
- 変更なし（PR 作成と CI ログ確認）

- [ ] **Step 1: ブランチを push**

Run: `git push -u origin feat/ci-github-actions`
Expected: リモートにブランチが作成される。

- [ ] **Step 2: PR を作成**

Run:
```bash
gh pr create --base main --title "ci: GitHub Actions CI（typecheck/test/build + MySQL統合テスト）" --body "$(cat <<'EOF'
## 概要
v0.4 Q1。CI を新設し、typecheck / test / build を3並列で実行。`test` ジョブは MySQL 8.0 を services で起動し、これまで skip されていた統合・スキーマテストを常時実行へ転換する。

## 変更
- `.github/workflows/ci.yml` 新設（push:main / PR:main宛、concurrency でキャンセル）
- ubuntu-latest / Node 22 / npm ci + npm cache
- `test` は env で `TEST_MYSQL_*` を注入（テストコードは無改修）

## スコープ外
- Biome lint（Q2）/ 署名・DMG・Release CI（Q4）/ ブランチ保護設定（手動）

spec: `docs/superpowers/specs/2026-06-15-ci-github-actions-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL が表示される。push をトリガに CI が起動。

- [ ] **Step 3: CI の結果を確認（3チェック緑）**

Run: `gh pr checks --watch`
Expected: `typecheck` / `test` / `build` の3つがすべて pass（緑）。

- [ ] **Step 4: 統合テストが実行されたことをログで確認**

Run:
```bash
gh run view --log $(gh run list --branch feat/ci-github-actions --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId') 2>/dev/null | grep -iE 'ConnectionManager \(integration\)|tableSchema \(integration\)' | head
```
Expected: 統合・スキーマテストの describe が**実行された**形で現れる（skip されていない）。Q1 のゴール達成の確認。

> もし `test` が赤い場合: MySQL の ready 待ち（health check）が効いているか、env の port(3306) が services の expose と一致しているかを確認。services は healthy になるまでステップを開始しないため、追加 wait は不要な想定。

---

## Self-Review 結果（記録）

- **Spec coverage:** §3.1 トリガ/concurrency=Task2 Step1、§3.2 ベース環境=各ジョブ steps、§3.3 3並列=Task2、§3.4 MySQL services+env=Task2 test ジョブ、§4 検証（skip→run 確認）=Task1 Step3 + Task3 Step4、§5 リスク（health check retries 20）=Task2 に反映。§6 フォローアップ（ブランチ保護/Biome/Q4）は非ゴールにつきタスク化せず PR body に注記。すべて対応済み。
- **Placeholder scan:** TODO/TBD なし。全ステップに実コマンド・期待出力を記載。
- **Type/値の一貫性:** port は CI=3306（services expose と env 一致）、ローカル検証=13306（compose と一致）で意図的に別。env キー名（`TEST_MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`）は spec・テストコードと一致。describe 名（`ConnectionManager (integration)` / `ConnectionManager.tableSchema (integration)`）は実コードと一致。
