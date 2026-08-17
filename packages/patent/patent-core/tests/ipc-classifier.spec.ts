import { describe, expect, it } from 'vitest'
import {
  classifyIpc,
  classifyIpcTop,
  getIpcDomain,
  IPC_DETAIL_MIN_CONFIDENCE,
  isHighConfidence,
} from '@deepseek-ai/dsh-patent-core'

describe('ipc-classifier', () => {
  it('classifies image-recognition text to G with detail G06', () => {
    const results = classifyIpc('一种基于深度学习的图像识别方法，通过数据处理算法对图像进行处理')
    const top = results[0]!
    expect(top.section).toBe('G')
    expect(top.confidence).toBeGreaterThanOrEqual(0.5)
    expect(top.matchedKeywords.includes('数据处理') || top.matchedKeywords.includes('图像处理')).toBe(true)
    expect(top.detail).toBe('G06')
    expect(top.detailConfidence).toBeDefined()
    expect(top.detailConfidence!).toBeGreaterThanOrEqual(IPC_DETAIL_MIN_CONFIDENCE)
  })

  it('classifies chemical synthesis text to C with detail C07', () => {
    const top = classifyIpcTop('一种高分子化合物的合成方法，涉及催化剂和化学反应')
    expect(top.section).toBe('C')
    expect(top.confidence).toBeGreaterThanOrEqual(0.5)
    expect(top.detail).toBe('C07')
  })

  it('classifies telecom text to H with detail H04', () => {
    const top = classifyIpcTop('一种无线通信电路，包含集成电路芯片和天线，用于移动通信网络')
    expect(top.section).toBe('H')
    expect(top.confidence).toBeGreaterThanOrEqual(0.5)
    expect(top.detail).toBe('H04')
  })

  it('classifies vehicle text to B with detail B60', () => {
    const top = classifyIpcTop('一种汽车车架的制造方法，涉及焊接和冲压工艺')
    expect(top.section).toBe('B')
    expect(top.detail).toBe('B60')
  })

  it('omits detail when section matches but no class keyword matches', () => {
    const top = classifyIpcTop('一种折叠桌椅组合结构，用于室内家具')
    expect(top.section).toBe('A')
    expect(top.detail).toBeUndefined()
  })

  it('produces equal confidence for equal keyword hits across sections', () => {
    const a = classifyIpcTop('医药药物药品').confidence
    const d = classifyIpcTop('纺织织物纤维').confidence
    expect(a).toBe(d)
    expect(a).toBeGreaterThan(0.7)
  })

  it('detailConfidence crosses the precise-injection threshold between 1 and 2 hits', () => {
    const single = classifyIpcTop('一种手性组合物')
    expect(single.detail).toBe('C07')
    expect(single.detailConfidence).toBeDefined()
    expect(single.detailConfidence!).toBeLessThan(IPC_DETAIL_MIN_CONFIDENCE)
    const multi = classifyIpcTop('一种手性有机化合物中间体')
    expect(multi.detail).toBe('C07')
    expect(multi.detailConfidence).toBeDefined()
    expect(multi.detailConfidence!).toBeGreaterThanOrEqual(IPC_DETAIL_MIN_CONFIDENCE)
  })

  it('returns the default B section with low confidence when nothing matches', () => {
    const results = classifyIpc('今天天气很好')
    expect(results[0]!.section).toBe('B')
    expect(results[0]!.confidence).toBe(0.15)
  })

  it('sorts multi-section results by confidence descending', () => {
    const results = classifyIpc('一种汽车发动机的制造方法，涉及金属合金材料')
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence)
    }
  })

  it('isHighConfidence uses the 0.80 threshold', () => {
    expect(isHighConfidence(0.8)).toBe(true)
    expect(isHighConfidence(0.79)).toBe(false)
  })

  it('getIpcDomain returns metadata', () => {
    const domain = getIpcDomain('G')
    expect(domain).toBeDefined()
    expect(domain!.name).toBe('物理')
    expect(domain!.inventivenessFocus.length).toBeGreaterThan(0)
    expect(getIpcDomain('Z')).toBeUndefined()
  })
})
