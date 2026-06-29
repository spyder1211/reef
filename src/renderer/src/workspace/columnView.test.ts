import { describe, expect, it } from 'vitest'
import { orderColumns, pinnedLeftOffsets } from './columnView'

describe('orderColumns', () => {
  it('hidden/pinned なしは元順・全て pinned:false', () => {
    expect(orderColumns(['a', 'b', 'c'], [], [])).toEqual([
      { name: 'a', pinned: false },
      { name: 'b', pinned: false },
      { name: 'c', pinned: false }
    ])
  })
  it('hidden を除外', () => {
    expect(orderColumns(['a', 'b', 'c'], ['b'], [])).toEqual([
      { name: 'a', pinned: false },
      { name: 'c', pinned: false }
    ])
  })
  it('pinned をピン順で先頭へ、残りは元順', () => {
    expect(orderColumns(['a', 'b', 'c', 'd'], [], ['c', 'a'])).toEqual([
      { name: 'c', pinned: true },
      { name: 'a', pinned: true },
      { name: 'b', pinned: false },
      { name: 'd', pinned: false }
    ])
  })
  it('hidden な pinned は出さない', () => {
    expect(orderColumns(['a', 'b'], ['a'], ['a'])).toEqual([{ name: 'b', pinned: false }])
  })
  it('現在名に無い hidden/pinned は無視', () => {
    expect(orderColumns(['a'], ['z'], ['y'])).toEqual([{ name: 'a', pinned: false }])
  })
})

describe('pinnedLeftOffsets', () => {
  it('ピンなしは全て null', () => {
    const ordered = [
      { name: 'a', pinned: false },
      { name: 'b', pinned: false }
    ]
    expect(pinnedLeftOffsets(ordered, [100, 80])).toEqual([null, null])
  })
  it('先頭ピンは 0 起点で累積、非ピンは null', () => {
    const ordered = [
      { name: 'c', pinned: true },
      { name: 'a', pinned: true },
      { name: 'b', pinned: false }
    ]
    expect(pinnedLeftOffsets(ordered, [120, 90, 200])).toEqual([0, 120, null])
  })
})
