import { describe, expect, it } from 'vitest'
import { boundsOfPoints, formatMm, MM_DECIMALS } from '../src/figure/mm-primitives.ts'

/** 毫米图元内核：坐标格式化与包围盒的唯一口径。 */

describe('formatMm', () => {
  it('默认保留至多三位小数并去掉尾随零', () => {
    expect(MM_DECIMALS).toBe(3)
    expect(formatMm(1.23456)).toBe('1.235')
    expect(formatMm(2)).toBe('2')
    expect(formatMm(1.5)).toBe('1.5')
    expect(formatMm(-0.0001)).toBe('0')
  })

  it('可按更松的精度格式化', () => {
    expect(formatMm(1.25, 1)).toBe('1.3')
    expect(formatMm(2, 1)).toBe('2')
  })

  it('只做算术：非有限数原样转成文本，由调用方校验', () => {
    expect(formatMm(Number.NaN)).toBe('NaN')
    expect(formatMm(Number.POSITIVE_INFINITY)).toBe('Infinity')
  })
})

describe('boundsOfPoints', () => {
  it('累加最小/最大坐标', () => {
    expect(boundsOfPoints([[1, 5], [-2, 3], [4, -1]])).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 })
  })

  it('单点包围盒退化为一对坐标', () => {
    expect(boundsOfPoints([[7, 8]])).toEqual({ minX: 7, minY: 8, maxX: 7, maxY: 8 })
  })

  it('空点集返回反向无穷（调用方保证非空）', () => {
    expect(boundsOfPoints([])).toEqual({
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    })
  })
})
