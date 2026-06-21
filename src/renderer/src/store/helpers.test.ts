import { describe, it, expect } from 'vitest'
import {
  filterProfiles,
  pickNextActiveTabId,
  hasUncommittedChanges,
  isProductionProfile,
  isCancelled
} from './helpers'
import { initials } from '../lib/tags'

describe('filterProfiles', () => {
  const profiles = [
    { id: '1', name: 'prod-api', host: 'db.example.com', database: 'api' },
    { id: '2', name: 'local', host: '127.0.0.1', database: 'app' }
  ]
  it('空検索は全件', () => {
    expect(filterProfiles(profiles, '')).toHaveLength(2)
  })
  it('名前/ホスト/DB を横断して部分一致', () => {
    expect(filterProfiles(profiles, 'example').map((p) => p.id)).toEqual(['1'])
    expect(filterProfiles(profiles, 'APP').map((p) => p.id)).toEqual(['2'])
  })
})

describe('pickNextActiveTabId', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('非アクティブを閉じてもアクティブは変わらない', () => {
    expect(pickNextActiveTabId(tabs, 'a', 'b')).toBe('b')
  })
  it('アクティブを閉じたら同位置（無ければ末尾）の隣を選ぶ', () => {
    expect(pickNextActiveTabId(tabs, 'b', 'b')).toBe('c')
    expect(pickNextActiveTabId(tabs, 'c', 'c')).toBe('b')
  })
  it('最後の1つを閉じたら null', () => {
    expect(pickNextActiveTabId([{ id: 'a' }], 'a', 'a')).toBeNull()
  })
})

describe('initials', () => {
  it('英数字名は先頭2文字', () => {
    expect(initials('point_invoice')).toBe('po')
  })
  it('日本語名も2文字', () => {
    expect(initials('城下町bot')).toBe('城下')
  })
})

describe('isProductionProfile', () => {
  it('tag が production なら true', () => {
    expect(isProductionProfile({ tag: 'production' })).toBe(true)
  })
  it('production 以外の tag は false', () => {
    expect(isProductionProfile({ tag: 'staging' })).toBe(false)
    expect(isProductionProfile({ tag: 'development' })).toBe(false)
    expect(isProductionProfile({ tag: 'local' })).toBe(false)
    expect(isProductionProfile({ tag: 'none' })).toBe(false)
  })
  it('null / undefined は false', () => {
    expect(isProductionProfile(null)).toBe(false)
    expect(isProductionProfile(undefined)).toBe(false)
  })
})

describe('hasUncommittedChanges', () => {
  const emptyTable = { kind: 'table', edits: {}, inserts: [], deletes: {} }
  it('edits が非空なら true', () => {
    expect(hasUncommittedChanges({ ...emptyTable, edits: { k: { pk: {}, values: {} } } })).toBe(
      true
    )
  })
  it('inserts が非空なら true', () => {
    expect(hasUncommittedChanges({ ...emptyTable, inserts: [{ localId: 'x', values: {} }] })).toBe(
      true
    )
  })
  it('deletes が非空なら true', () => {
    expect(hasUncommittedChanges({ ...emptyTable, deletes: { k: {} } })).toBe(true)
  })
  it('TableTab で 3 つすべて空なら false', () => {
    expect(hasUncommittedChanges(emptyTable)).toBe(false)
  })
  it('SqlTab は常に false', () => {
    expect(hasUncommittedChanges({ kind: 'sql' })).toBe(false)
  })
})

describe('isCancelled', () => {
  it('CANCELLED の失敗結果は true', () => {
    expect(isCancelled({ ok: false, error: { code: 'CANCELLED', message: '' } })).toBe(true)
  })
  it('他のエラーコードは false', () => {
    expect(isCancelled({ ok: false, error: { code: 'DB_ERROR', message: 'x' } })).toBe(false)
  })
  it('成功結果は false', () => {
    expect(isCancelled({ ok: true, data: null })).toBe(false)
  })
})
