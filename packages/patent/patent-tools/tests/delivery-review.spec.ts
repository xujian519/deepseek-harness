import { describe, expect, it } from 'vitest'
import { checkFigureDelivery } from '../src/figure/delivery-review.ts'

/** 包一张最小 SVG；画布尺寸按用例给出。 */
function svg(body: string, width = '100mm', height = '100mm', viewBox = '0 0 100 100'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${body}</svg>`
}

describe('checkFigureDelivery', () => {
  it('位图/照片给出 figure-photo', () => {
    const findings = checkFigureDelivery(svg('<image href="photo.png" width="10" height="10"/>'))
    expect(findings.map(finding => finding.check)).toContain('figure-photo')
  })

  it('横向图纸给出 figure-orientation', () => {
    const findings = checkFigureDelivery(svg('<rect x="10" y="10" width="20" height="20"/>', '120mm', '40mm', '0 0 120 40'))
    expect(findings.map(finding => finding.check)).toContain('figure-orientation')
    expect(findings.find(finding => finding.check === 'figure-orientation')?.message).toContain('竖向')
  })

  it('覆盖整幅图纸的闭合轮廓给出 figure-frame', () => {
    const findings = checkFigureDelivery(svg('<rect x="1" y="1" width="98" height="98" fill="none" stroke="#000"/>'))
    expect(findings.map(finding => finding.check)).toContain('figure-frame')
  })

  it('图面词语复用既有用词规则', () => {
    const findings = checkFigureDelivery(svg('<text x="10" y="10">controller</text>'))
    expect(findings.map(finding => finding.check)).toContain('figure-wording')
  })

  it('画布尺寸缺失时跳横向与外框判据', () => {
    expect(checkFigureDelivery('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="9" height="9"/></svg>'))
      .toEqual([])
  })

  it('竖向、无位图、无外框、纯中文标号时无发现', () => {
    expect(checkFigureDelivery(svg([
      '<polygon points="20,20 80,20 80,80 20,80" fill="none" stroke="#000"/>',
      '<text x="50" y="50">1</text>',
    ].join('')))).toEqual([])
  })
})
