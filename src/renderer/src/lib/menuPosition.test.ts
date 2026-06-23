import { describe, expect, it } from 'vitest'
import { clampMenuPosition } from './menuPosition'

const vp = { width: 1000, height: 800 }

describe('clampMenuPosition', () => {
  it('収まる場合はアンカーそのまま', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, { width: 200, height: 150 }, vp)).toEqual({
      top: 100,
      left: 100
    })
  })
  it('右端を超えるとアンカーから左へフリップ', () => {
    // x=900, width=200 → 900+200=1100 > 1000-4 → left = 900-200 = 700
    expect(clampMenuPosition({ x: 900, y: 100 }, { width: 200, height: 150 }, vp).left).toBe(700)
  })
  it('下端を超えるとアンカーから上へフリップ', () => {
    // y=750, height=150 → 750+150=900 > 800-4 → top = 750-150 = 600
    expect(clampMenuPosition({ x: 100, y: 750 }, { width: 200, height: 150 }, vp).top).toBe(600)
  })
  it('両端を超えると両方フリップ', () => {
    expect(clampMenuPosition({ x: 950, y: 780 }, { width: 200, height: 150 }, vp)).toEqual({
      top: 630,
      left: 750
    })
  })
  it('フリップしても収まらない（メニューがビューポート級）と margin にクランプ', () => {
    expect(clampMenuPosition({ x: 900, y: 100 }, { width: 1200, height: 150 }, vp, 4).left).toBe(4)
  })
  it('margin 既定は 4（フリップ後も右マージンを保つようクランプ）', () => {
    // x=998, width=10 → 998+10=1008 > 1000-4 → flip 998-10=988、
    // さらに max=1000-10-4=986 を超えるため 986 にクランプ（右に4pxマージン）
    expect(clampMenuPosition({ x: 998, y: 10 }, { width: 10, height: 10 }, vp).left).toBe(986)
  })
})
