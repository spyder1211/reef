import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, ConnectionTag } from '../../../shared/types'
import { useAppStore } from './useAppStore'

function profile(tag: ConnectionTag): ConnectionProfile {
  return { id: 'p1', name: 'prod-db', tag, host: 'db', port: 3306, user: 'root' }
}

// 接続成功を返す window.api スタブ（IPC 境界）。connect 用に最小限の応答を返す。
function okApi(connectSpy: () => unknown) {
  return {
    connections: { connect: connectSpy },
    listTables: vi.fn(async () => ({ ok: true, data: [] })),
    schemaMap: vi.fn(async () => ({ ok: true, data: {} }))
  }
}

function resetStore(): void {
  useAppStore.setState({
    status: 'idle',
    activeProfile: null,
    connectError: null,
    tabs: [],
    activeTabId: null,
    tables: [],
    schemaMap: {}
  })
}

describe('connect の本番ガード', () => {
  beforeEach(resetStore)
  afterEach(() => vi.unstubAllGlobals())

  it('production で確認をキャンセルすると接続しない', async () => {
    const connectSpy = vi.fn(async () => ({ ok: true, data: undefined }))
    vi.stubGlobal('window', {
      confirm: vi.fn(() => false),
      api: okApi(connectSpy)
    })

    await useAppStore.getState().connect(profile('production'))

    expect(connectSpy).not.toHaveBeenCalled()
    expect(useAppStore.getState().status).toBe('idle')
    expect(useAppStore.getState().activeProfile).toBeNull()
  })

  it('production で確認を承認すると接続する', async () => {
    const connectSpy = vi.fn(async () => ({ ok: true, data: undefined }))
    const confirm = vi.fn(() => true)
    vi.stubGlobal('window', { confirm, api: okApi(connectSpy) })

    await useAppStore.getState().connect(profile('production'))

    expect(confirm).toHaveBeenCalledOnce()
    expect(connectSpy).toHaveBeenCalledOnce()
    expect(useAppStore.getState().status).toBe('connected')
  })

  it('production 以外は確認を出さずに接続する', async () => {
    const connectSpy = vi.fn(async () => ({ ok: true, data: undefined }))
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', { confirm, api: okApi(connectSpy) })

    await useAppStore.getState().connect(profile('staging'))

    expect(confirm).not.toHaveBeenCalled()
    expect(connectSpy).toHaveBeenCalledOnce()
    expect(useAppStore.getState().status).toBe('connected')
  })
})
