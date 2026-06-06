import { describe, it, expect } from 'vitest'
import { buildSelectQuery, filterProfiles, pickNextActiveTabId } from './helpers'
import { initials } from '../lib/tags'

describe('buildSelectQuery', () => {
  it('バッククォート付きの SELECT を作る', () => {
    expect(buildSelectQuery('users')).toBe('SELECT * FROM `users` LIMIT 100;')
  })
})

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
