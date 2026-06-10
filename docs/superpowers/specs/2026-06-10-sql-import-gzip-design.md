# gzip 圧縮 SQL ダンプ（.sql.gz）の import 対応 設計

作成日: 2026-06-10

## 背景

SQL ダンプの import/restore（issue #11、PR #11）は `.sql`（非圧縮）ファイルのみを対象としている。`menu.ts` のファイルダイアログは `extensions: ['sql']` で、`SqlImporter.ts` は `createReadStream(filePath, { encoding: 'utf-8' })` でテキストとして直接読む。

実運用では `mysqldump | gzip` で作られた `.sql.gz`（例: `kbyxs_db_105_2026-06-10.sql.gz`）が一般的。本変更で gzip 圧縮された SQL ダンプも import できるようにする。

判定は**ファイル先頭2バイトのマジックバイト（`0x1f 0x8b`）**で行い、ファイル名に依存しない（`.sql` という名前でも中身が gzip なら展開、`.gz` でも非圧縮ならそのまま読む）。

## スコープ

| 対象 | 内容 |
|---|---|
| import の gzip 展開 | 先頭2バイトで gzip 判定 → `zlib.createGunzip()` で展開してから既存の splitter/逐次実行に流す |
| 進捗のバイト基準 | **圧縮バイト基準**（gunzip の前で生バイトを数える）。`totalBytes` は圧縮ファイルサイズのまま |
| ダイアログのフィルタ | `extensions: ['sql', 'gz']` に拡張 |

非圧縮 `.sql` の既存挙動は不変（同じパイプラインを通すが結果は等価）。

## 設計

### 1. gzip 判定ヘルパー（新規）— `src/main/import/gzip.ts`

```ts
import { open } from 'fs/promises'

/** Buffer 先頭が gzip マジックバイト（0x1f 0x8b）か。2バイト未満は false。 */
export function isGzipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

/** ファイル先頭2バイトだけ読んで gzip かを判定する。 */
export async function isGzipFile(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(2)
    const { bytesRead } = await fh.read(buf, 0, 2, 0)
    return isGzipMagic(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}
```

- `isGzipMagic` は純関数でユニットテスト対象。
- `isGzipFile` は薄い fs ラッパー。

### 2. 読み取りパイプラインの変更 — `src/main/import/SqlImporter.ts`

現状（22〜69行相当）の `createReadStream(filePath, { encoding: 'utf-8' })` を直接 `for await` する形を、次のパイプラインに置き換える。

```
createReadStream(filePath)            // encoding 指定なし＝生 Buffer
  → counter(Transform)               // chunk.length を bytesRead に加算（圧縮バイト）
  → [ gzip なら createGunzip() ]      // 展開
  → StringDecoder('utf8') で逐次デコード
  → SqlStatementSplitter
```

実装方針:

```ts
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createGunzip } from 'zlib'
import { Transform } from 'stream'
import { StringDecoder } from 'string_decoder'
import { isGzipFile } from './gzip'
// ...

const totalBytes = (await stat(filePath)).size   // 圧縮ファイルサイズ（変更なし）
const gzip = await isGzipFile(filePath)

await manager.withDedicatedConnection(async (exec) => {
  const splitter = new SqlStatementSplitter()
  const decoder = new StringDecoder('utf8')

  const raw = createReadStream(filePath)
  // gunzip の前段で「圧縮バイト」を数える。これにより totalBytes（圧縮サイズ）と整合し進捗が 0→100% になる。
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb): void {
      bytesRead += chunk.length
      cb(null, chunk)
    }
  })
  const byteSource = raw.pipe(counter)
  const textSource = gzip ? byteSource.pipe(createGunzip()) : byteSource

  // runOne は現状のまま（1 文実行→成功で executedCount++・onProgress、失敗で failure 記録して false）

  try {
    for await (const chunk of textSource) {
      const text = decoder.write(chunk as Buffer)
      if (text) {
        for (const stmt of splitter.push(text)) {
          if (!(await runOne(stmt))) return
        }
      }
    }
    const tail = decoder.end()
    if (tail) {
      for (const stmt of splitter.push(tail)) {
        if (!(await runOne(stmt))) return
      }
    }
    for (const stmt of splitter.end()) {
      if (!(await runOne(stmt))) return
    }
  } catch (err) {
    // ここに来る例外は読み取り/展開の失敗のみ（DB エラーは runOne 内で握る）。
    if (gzip) {
      throw new Error('gzip の展開に失敗しました（ファイルが壊れている可能性があります）')
    }
    throw err
  } finally {
    raw.destroy()
  }
})
```

ポイント:

- **進捗は圧縮バイト基準**: `counter` を gunzip の**前**に置き、ディスクから読んだ生（圧縮）バイトを `bytesRead` に加算する。`totalBytes` は従来どおり `stat().size`（圧縮サイズ）。展開後バイトで数えると比率が 100% を超えるため、必ず圧縮側で数える。
- **`StringDecoder` 必須**: 生 Buffer を自前デコードするので、UTF-8 のマルチバイト文字がチャンク境界で割れて壊れないよう `StringDecoder('utf8')` を使う（現状の `{ encoding: 'utf-8' }` が担っていた役割の置き換え）。最後に `decoder.end()` で末尾を回収する。
- **非圧縮も同一経路**: gzip でない場合は gunzip 段を挟まないだけで、counter＋StringDecoder を通す。結果は現状と等価。
- `runOne` / `failure` / `ImportSummary` の返却ロジックは変更しない（stop-on-error のまま）。

### 3. ファイルダイアログのフィルタ — `src/main/menu.ts`

`importSqlDump()` 内（98行相当）:

```ts
filters: [{ name: 'SQL dump', extensions: ['sql', 'gz'] }]
```

`.sql.gz` は末尾拡張子 `gz` で一致する。renderer の確認モーダルへ送る `totalBytes`（= `stat().size`）は圧縮サイズのままで、モーダルにはファイル名と圧縮サイズが表示される。

## エラーハンドリング

- **壊れた gz（展開失敗）**: `createGunzip()` が stream の `error`（例: `Z_DATA_ERROR` / "incorrect header check"）を発火すると、`for await (const chunk of textSource)` の非同期イテレータがその例外を throw する。これをストリーミングループを囲む `try/catch` で捕捉する。per-statement の DB エラーは `runOne` 内で握って `false` を返し throw しないため、ここに到達する例外は読み取り/展開の失敗に限られる。`gzip === true` の場合は「gzip の展開に失敗しました（ファイルが壊れている可能性があります）」というメッセージの `Error` に包んで rethrow し、非 gzip の場合はそのまま rethrow する。いずれも `withDedicatedConnection` を抜けて `importSqlDump` の呼び出し元（`registerImportHandlers`）の `catch` が受け、`{ ok: false, error }` として確認モーダルにエラー表示する。
- **空ファイル / 2バイト未満**: gzip ではないと判定 → 非圧縮として読む → 0 文 → `completed`。
- **読み取りエラー（権限等）**: 既存どおり throw → IPC ハンドラの `catch` で処理。

## テスト

- `src/main/import/gzip.test.ts`（新規）:
  - `isGzipMagic(Buffer.from([0x1f, 0x8b, ...]))` → `true`
  - `isGzipMagic(Buffer.from('SELECT 1'))` → `false`
  - `isGzipMagic(Buffer.from([0x1f]))`（1バイト）→ `false`
  - `isGzipMagic(Buffer.alloc(0))` → `false`
- `src/main/import/SqlImporter.test.ts`（既存に追加）:
  - SQL 文字列（複数文）を `zlib.gzipSync` で圧縮して一時 `.sql.gz` に書き、`importSqlDump` で展開・逐次実行され、実行された文がモック executor に渡ること。
  - その import の進捗 `totalBytes` が圧縮ファイルサイズ（= `stat().size`）であること、`status: 'completed'`、`executedCount` が文数と一致すること。
  - 非圧縮 `.sql` の既存テストが引き続き通ること（マルチバイト UTF-8 を含むケースがあれば StringDecoder 経路で壊れないこと）。
- `npm run typecheck` と `npm test` が通ること。

## 非スコープ

- エクスポート側の gzip 圧縮出力（今回は import のみ。`SqlDumper` は対象外）。
- gzip 以外の圧縮形式（zip / bzip2 / xz 等）。
- 複数メンバを束ねた gzip や tar.gz（単一 gzip ストリーム前提）。
- 圧縮ファイル選択時に「展開後サイズ」を別途表示する UI（圧縮サイズ表示で十分）。
