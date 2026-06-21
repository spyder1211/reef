import { describe, expect, it } from 'vitest'
import { deriveLead, nextArrowSelection } from './gridSelection'

describe('deriveLead', () => {
  it('選択が空なら null', () => {
    expect(deriveLead([], 5)).toBeNull()
    expect(deriveLead([], null)).toBeNull()
  })

  it('アンカー未設定なら最後の選択行', () => {
    expect(deriveLead([2, 5, 7], null)).toBe(7)
  })

  it('単一選択ならその行（アンカーと同じ）', () => {
    expect(deriveLead([5], 5)).toBe(5)
  })

  it('連続範囲ではアンカーと反対側の端', () => {
    expect(deriveLead([5, 6, 7], 5)).toBe(7) // 下方向に伸ばした範囲
    expect(deriveLead([3, 4, 5], 5)).toBe(3) // 上方向に伸ばした範囲
  })
})

describe('nextArrowSelection', () => {
  it('rowCount<=0 なら null', () => {
    expect(nextArrowSelection(0, null, null, 1, false)).toBeNull()
  })

  it('未選択 + 下キーは先頭行を単一選択', () => {
    expect(nextArrowSelection(5, null, null, 1, false)).toEqual({
      indices: [0],
      anchor: 0,
      lead: 0
    })
  })

  it('未選択 + 上キーは末尾行を単一選択', () => {
    expect(nextArrowSelection(5, null, null, -1, false)).toEqual({
      indices: [4],
      anchor: 4,
      lead: 4
    })
  })

  it('shift なし下キーは lead を1つ進めて単一選択（アンカーも移動）', () => {
    expect(nextArrowSelection(5, 2, 2, 1, false)).toEqual({
      indices: [3],
      anchor: 3,
      lead: 3
    })
  })

  it('shift あり下キーはアンカー固定で範囲拡張', () => {
    expect(nextArrowSelection(5, 2, 2, 1, true)).toEqual({
      indices: [2, 3],
      anchor: 2,
      lead: 3
    })
  })

  it('shift あり下キーを連続適用すると範囲が伸びる', () => {
    expect(nextArrowSelection(5, 2, 3, 1, true)).toEqual({
      indices: [2, 3, 4],
      anchor: 2,
      lead: 4
    })
  })

  it('shift あり上キーは範囲を縮める', () => {
    // 選択 [2,3,4] アンカー2 lead4 から上キー → lead3 で [2,3]
    expect(nextArrowSelection(5, 2, 4, -1, true)).toEqual({
      indices: [2, 3],
      anchor: 2,
      lead: 3
    })
  })

  it('shift ありでアンカーをまたぐと反対側へ範囲が反転', () => {
    // アンカー2 lead2 から上キー → lead1 で [1,2]
    expect(nextArrowSelection(5, 2, 2, -1, true)).toEqual({
      indices: [1, 2],
      anchor: 2,
      lead: 1
    })
  })

  it('上端・下端でクランプ', () => {
    expect(nextArrowSelection(5, 0, 0, -1, false)).toEqual({ indices: [0], anchor: 0, lead: 0 })
    expect(nextArrowSelection(5, 4, 4, 1, false)).toEqual({ indices: [4], anchor: 4, lead: 4 })
  })

  it('アンカー null + shift は lead をアンカー代わりにする', () => {
    expect(nextArrowSelection(5, null, 2, 1, true)).toEqual({
      indices: [2, 3],
      anchor: 2,
      lead: 3
    })
  })
})
