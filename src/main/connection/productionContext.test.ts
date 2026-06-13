import { describe, it, expect, beforeEach } from 'vitest'
import {
  setProductionContext,
  clearProductionContext,
  getProductionContext,
  isProductionConnection
} from './productionContext'

describe('productionContext', () => {
  beforeEach(() => clearProductionContext())

  it('初期状態は null・非 production', () => {
    expect(getProductionContext()).toBeNull()
    expect(isProductionConnection()).toBe(false)
  })

  it('production をセットすると isProductionConnection が true', () => {
    setProductionContext({ tag: 'production', name: '本番DB' })
    expect(isProductionConnection()).toBe(true)
    expect(getProductionContext()).toEqual({ tag: 'production', name: '本番DB' })
  })

  it('production 以外のタグは false', () => {
    setProductionContext({ tag: 'staging', name: 'stg' })
    expect(isProductionConnection()).toBe(false)
  })

  it('clear で null・非 production に戻る', () => {
    setProductionContext({ tag: 'production', name: '本番DB' })
    clearProductionContext()
    expect(getProductionContext()).toBeNull()
    expect(isProductionConnection()).toBe(false)
  })
})
