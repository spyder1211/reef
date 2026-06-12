import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { QueryHistoryEntry } from '../../shared/types'

const MAX_ENTRIES = 500

// SQL 実行履歴を userData 配下の JSON に永続化する。新しい順で保持。
export class QueryHistoryStore {
  private readonly filePath: string
  private entries: QueryHistoryEntry[]

  constructor(baseDir: string) {
    mkdirSync(baseDir, { recursive: true })
    this.filePath = join(baseDir, 'query-history.json')
    this.entries = this.load()
  }

  private load(): QueryHistoryEntry[] {
    if (!existsSync(this.filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return [] // 壊れたファイルは捨てて空から始める
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.entries))
  }

  add(input: Omit<QueryHistoryEntry, 'id' | 'executedAt'>): QueryHistoryEntry {
    const entry: QueryHistoryEntry = {
      ...input,
      id: randomUUID(),
      executedAt: new Date().toISOString()
    }
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES)
    this.persist()
    return entry
  }

  list(): QueryHistoryEntry[] {
    return this.entries
  }

  clear(): void {
    this.entries = []
    this.persist()
  }
}
