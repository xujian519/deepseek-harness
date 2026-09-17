import { describe, expect, it } from 'vitest'
import { annotateSvgWithLeaderLines } from '../src/figure/leader-line.ts'

/**
 * 引线几何：坐标帧（组平移）、图内线条避让（边路径/箭头/边标签）与画布扩边。
 * fixture 与真实 dot/WASM 输出同构：`<g class="graph" transform=…>` 包裹
 * `<g class="node">`（title + polygon + text）与 `<g class="edge">`。
 */

/** 生成一个节点组（points 为组坐标系的轮廓）。 */
function node(id: string, label: string, points: string): string {
  return [
    `<g id="node-${id}" class="node">`,
    `<title>${id}</title>`,
    `<polygon fill="none" stroke="black" points="${points}"/>`,
    `<text text-anchor="middle" x="80" y="-24" font-family="Helvetica" font-size="10.00">${label}</text>`,
    '</g>',
  ].join('\n')
}

/** 生成一个边组（内容由调用方给出）。 */
function edge(id: string, body: string): string {
  return [`<g id="edge-${id}" class="edge">`, `<title>${id}</title>`, body, '</g>'].join('\n')
}

/** 组装 SVG：root 为根元素开标签，body 为图内容，transform 为外层组变换（缺省无外层组）。 */
function document(root: string, body: string, transform?: string): string {
  const inner = transform === undefined
    ? body
    : `<g id="graph0" class="graph" transform="${transform}">\n${body}\n</g>`
  return `${root}\n${inner}\n</svg>`
}

/** 真实 dot 输出的根元素（viewBox 即布局加约 4pt 边距）。 */
const ROOT_GRAPHVIZ = '<svg width="200pt" height="100pt" viewBox="0.00 0.00 200.00 100.00" xmlns="http://www.w3.org/2000/svg">'

/** Graphviz 15 的外层组变换（恒等 scale/rotate + 平移）。 */
const GRAPHVIZ_FRAME = 'scale(1 1) rotate(0) translate(4 66)'

describe('annotateSvgWithLeaderLines 坐标帧', () => {
  it('节点组坐标经外层组平移换算：引线落在节点轮廓上而不是偏移一个组平移', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      node('a', '传感器', '0,-44 0,-12 60,-12 60,-44'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    // 组坐标右边缘 60 经 translate(4 66) 换算为根坐标 64；中线 y=-28 → 38。
    expect(out).toContain('<line x1="64" y1="38" x2="74" y2="38"')
    expect(out).toContain('<text x="77" y="41.5"')
  })

  it('多层组平移累加，且左上越界时画布外移', () => {
    const svg = document(
      '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">',
      `<g transform="translate(4 6)">\n${node('a', '传感器', '0,-44 0,-12 40,-12 40,-44')}\n</g>`,
      'translate(10 20)',
    )
    const { svg: out } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    // 组坐标右边缘 40 → 根 54；中线 y=-28 → -28+6+20 = -2；标号框顶到 -8，越出画布上边界。
    expect(out).toContain('<line x1="54" y1="-2" x2="64" y2="-2"')
    expect(out).toContain('viewBox="0 -10 200 110"')
  })

  it('matrix 形式的纯平移被接受，缩放/旋转/斜切退化为内嵌标号并告警', () => {
    const accepted = [
      'matrix(1 0 0 1 5 6)',
      'translate(4)',
      'translate(4 6)',
      'scale(1 1)',
      'rotate(0)',
    ]
    for (const transform of accepted) {
      const svg = document(ROOT_GRAPHVIZ, node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'), transform)
      const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
      // 接受纯平移：不退化为内嵌（画布扩边告警与本用例无关，节点在画布上方属正常扩边）。
      expect(warnings.filter(w => w.includes('已内嵌')), transform).toEqual([])
      expect(out, transform).toContain('<line ')
    }
    const degraded = ['scale(2 2)', 'rotate(45)', 'rotate(0 5 5)', 'skewX(10)', 'matrix(2 0 0 2 0 0)', 'matrix(1 0 0 1 0)', 'translate(a b)']
    for (const transform of degraded) {
      const svg = document(ROOT_GRAPHVIZ, node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'), transform)
      const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
      expect(warnings, transform).toEqual(['节点 "a" 所在组的坐标含缩放/旋转，标号 100 已内嵌'])
      expect(out, transform).not.toContain('<line ')
      expect(out, transform).toContain('传感器 (100)')
    }
  })
})

describe('annotateSvgWithLeaderLines 图内线条避让', () => {
  it('右向候选与出边共线时改走左侧，引线不压在连接线上', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        // 出边自右边缘中线向右延伸，与右向候选引线共线。
        edge('a-b', '<path fill="none" stroke="black" d="M120,-28C130,-28 150,-28 170,-28"/>'),
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="44" y1="38" x2="34" y2="38"')
    expect(out).not.toContain('<line x1="124"')
  })

  it('箭头多边形占据右向位置时改走左侧', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        edge('b-a', '<polygon fill="black" stroke="black" points="120,-29 130,-29 130,-27 120,-27"/>'),
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="44" y1="38" x2="34" y2="38"')
  })

  it('穿过标号框的边线使该方向不可用（左右皆被占时改走上向）', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        // 左邻节点挡住左向候选。
        node('b', '邻件', '0,-44 0,-12 36,-12 36,-44'),
        // 竖直线段穿过右向标号框（根坐标 x=144，框为 137-157），不碰引线线段。
        edge('a-b', '<path fill="none" stroke="black" d="M140,-70C140,-60 140,-40 140,-10"/>'),
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="84" y1="22" x2="84" y2="12"')
  })

  it('边标签文本框按锚点估算并参与避让，缺坐标的标签忽略', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        // 中间锚点标签压在右向标号框上。
        edge('a-b', '<text text-anchor="middle" x="145" y="-24" font-size="10.00">信号</text>'),
        // 末端锚点标签与缺坐标标签：前者参与避让，后者忽略。
        edge('b-c', '<text text-anchor="end" x="200" y="-24" font-size="10.00">结果</text>\n<text text-anchor="middle">无坐标</text>'),
        // 无 font-size、起始锚点的非 CJK 标签：按窄字宽估算。
        edge('c-d', '<text text-anchor="start" x="190" y="-18">data flow</text>'),
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).not.toContain('<line x1="124"')
  })

  it('边路径的 L 段与多段 C 均参与避让，非法路径不再作为障碍', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        // L 段与两段 C：都在右向引线走廊上。
        edge('a-b', '<path fill="none" stroke="black" d="M120,-28L130,-28 140,-28"/>'),
        edge('a-c', '<path fill="none" stroke="black" d="M120,-28C125,-28 130,-28 135,-28 140,-28 145,-28 150,-28"/>'),
        // 以下路径无法解析（缺命令/缺数值/数值非法），不产生障碍。
        edge('a-d', '<path fill="none" stroke="black" d="M 1"/>'),
        edge('a-e', '<path fill="none" stroke="black" d="M x,y C 1,2 3,4 5,6"/>'),
        edge('a-f', '<path fill="none" stroke="black" d="L 1,-10"/>'),
        edge('a-g', '<path fill="none" stroke="black" d="M 0,-10 C 1,2 3"/>'),
        edge('a-h', '<path fill="none" stroke="black" d="C 1,2 3,4 5,6"/>'),
        edge('a-i', '<path fill="none" stroke="black" d="m 0 -10 c 1 1 2 2 3 3"/>'),
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="44" y1="38" x2="34" y2="38"')
  })

  it('含缩放的组内的边不参与避让（坐标不可换算）', () => {
    const svg = document(
      ROOT_GRAPHVIZ,
      [
        node('a', '传感器', '40,-44 40,-12 120,-12 120,-44'),
        `<g transform="scale(2 2)">\n${edge('a-b', '<path fill="none" stroke="black" d="M120,-28C130,-28 150,-28 170,-28"/>')}\n</g>`,
      ].join('\n'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    // 不可换算的边不构成障碍：右向候选仍可用。
    expect(out).toContain('<line x1="124" y1="38" x2="134" y2="38"')
  })
})

describe('annotateSvgWithLeaderLines 画布扩展', () => {
  /** 节点右边缘在根坐标 144（组 140 + 平移 4），右向标号框必然越出 150pt 画布。 */
  const tightBody = node('a', '传感器', '40,-44 40,-12 140,-12 140,-44')

  it('根元素仅有 viewBox 时只改写 viewBox，不新增尺寸属性', () => {
    const svg = document('<svg viewBox="0 0 150 60" xmlns="http://www.w3.org/2000/svg">', tightBody, GRAPHVIZ_FRAME)
    const { svg: out } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(out).toContain('viewBox="0 0 177.5 60"')
    expect(out).toContain('<svg viewBox="0 0 177.5 60" xmlns="http://www.w3.org/2000/svg">')
  })

  it('无 viewBox 时按 width/height（含长度单位换算）合成等价视口并改写为 px', () => {
    const svg = document('<svg width="150pt" height="60pt" xmlns="http://www.w3.org/2000/svg">', tightBody, GRAPHVIZ_FRAME)
    const { svg: out } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    // 150pt=200px、60pt=80px：右向标号框到 177px 未越界，画布保持原样。
    expect(out).toContain('<svg width="150pt" height="60pt"')
    expect(out).not.toContain('viewBox')
    const wider = document('<svg width="150pt" height="60pt" xmlns="http://www.w3.org/2000/svg">', node('a', '传感器', '40,-44 40,-12 190,-12 190,-44'), GRAPHVIZ_FRAME)
    const { svg: grown } = annotateSvgWithLeaderLines(wider, [{ label: '传感器', numeral: '100' }])
    expect(grown).toContain('viewBox="0 0 227.5 80"')
    expect(grown).toContain('width="227.5px"')
    expect(grown).toContain('height="80px"')
  })

  it('尺寸无法换算（百分比/单值/非法 viewBox）时跳过扩边，图面其余部分照旧', () => {
    for (const root of [
      '<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">',
      '<svg width="300" xmlns="http://www.w3.org/2000/svg">',
      '<svg viewBox="0 0 150" xmlns="http://www.w3.org/2000/svg">',
      '<svg viewBox="0 0 0 60" xmlns="http://www.w3.org/2000/svg">',
      '<svg viewBox="a b c d" xmlns="http://www.w3.org/2000/svg">',
    ]) {
      const svg = document(root, tightBody, GRAPHVIZ_FRAME)
      const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
      expect(warnings, root).toEqual([])
      expect(out, root).toContain('<line ')
      expect(out, root).toContain(root)
    }
  })

  it('有 viewBox 但尺寸单位不可换算时只改写 viewBox', () => {
    const root = '<svg width="100%" height="60pt" viewBox="0 0 150 60" xmlns="http://www.w3.org/2000/svg">'
    const svg = document(root, tightBody, GRAPHVIZ_FRAME)
    const { svg: out } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(out).toContain('viewBox="0 0 177.5 60"')
    expect(out).toContain('width="100%"')
    expect(out).toContain('height="60pt"')
  })

  it('多余的 </g> 不影响放置（解析容错）', () => {
    const svg = `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">\n</g>\n<g id="graph0" class="graph" transform="translate(4 66)">\n${tightBody}\n</g>\n</svg>`
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="144" y1="38" x2="154" y2="38"')
  })
})

describe('annotateSvgWithLeaderLines 字宽与 scale 归一', () => {
  /** 单节点组（可指定 font-size），points 为组坐标系轮廓。 */
  function sizedNode(label: string, points: string, fontSize: string): string {
    return [
      '<g id="node1" class="node">',
      '<title>a</title>',
      `<polygon fill="none" stroke="black" points="${points}"/>`,
      `<text text-anchor="middle" x="30" y="-24" font-size="${fontSize}">${label}</text>`,
      '</g>',
    ].join('\n')
  }

  it('标号 font-size 实读节点文本：字号 20 时 scale=2，引线间隙同比放大到 20', () => {
    const svg = document(
      '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">',
      sizedNode('传感器', '0,-44 0,-12 60,-12 60,-44', '20.00'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    // 右边缘根坐标 64，scale=median(20)/10=2 → gap=20，引线到 84；标号 font-size 实读为 20。
    expect(out).toContain('<line x1="64" y1="38" x2="84" y2="38"')
    expect(out).toContain('font-size="20"')
  })

  it('两节点字号中位决定 scale（偶数取均值）：font 10 与 30 → scale 2 → gap 20', () => {
    const svg = `<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg">
<g id="node1" class="node"><title>a</title><polygon fill="none" stroke="black" points="0,0 0,40 60,40 60,0"/><text text-anchor="middle" x="30" y="24" font-size="10.00">甲</text></g>
<g id="node2" class="node"><title>b</title><polygon fill="none" stroke="black" points="400,0 400,40 460,40 460,0"/><text text-anchor="middle" x="430" y="24" font-size="30.00">乙</text></g>
</svg>`
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '甲', numeral: '10' }, { label: '乙', numeral: '20' }])
    expect(warnings).toEqual([])
    // median(10,30)=20 → scale 2 → gap 20：甲右边缘 60 → 80（甲自身 font-size 10 只影响标号框）。
    expect(out).toContain('<line x1="60" y1="20" x2="80" y2="20"')
  })

  it('节点 font-size 非法（0）回退基线 10：scale=1、gap=10', () => {
    const svg = document(
      '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">',
      sizedNode('传感器', '0,-44 0,-12 60,-12 60,-44', '0'),
      GRAPHVIZ_FRAME,
    )
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '传感器', numeral: '100' }])
    expect(warnings).toEqual([])
    expect(out).toContain('<line x1="64" y1="38" x2="74" y2="38"')
  })

  it('无节点组时 scale 回退 1，仅报未命中', () => {
    const { svg, warnings } = annotateSvgWithLeaderLines(
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"></svg>',
      [{ label: '甲', numeral: '10' }],
    )
    expect(warnings).toEqual(['参考 "甲" 未命中任何节点'])
    expect(svg).not.toContain('<line ')
  })
})

describe('annotateSvgWithLeaderLines 斜向二次扫描', () => {
  it('正交四向被邻节点占满时改走斜向锚点，不退化为内嵌', () => {
    // core 四边被墙堵住，但顶墙只覆盖左半（x≤80），右上角点 (100,50) 的 45° 斜向逃逸通道畅通。
    const svg = `<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
<g id="node1" class="node"><title>core</title><polygon fill="none" stroke="black" points="50,50 50,100 100,100 100,50"/><text text-anchor="middle" x="75" y="79" font-size="10.00">主控板</text></g>
<g id="node2" class="node"><title>wall-r</title><polygon fill="none" stroke="black" points="105,60 105,90 140,90 140,60"/><text text-anchor="middle" x="122" y="79" font-size="10.00">右墙</text></g>
<g id="node3" class="node"><title>wall-l</title><polygon fill="none" stroke="black" points="10,60 10,90 45,90 45,60"/><text text-anchor="middle" x="27" y="79" font-size="10.00">左墙</text></g>
<g id="node4" class="node"><title>wall-t</title><polygon fill="none" stroke="black" points="40,10 40,45 80,45 80,10"/><text text-anchor="middle" x="60" y="29" font-size="10.00">顶墙</text></g>
<g id="node5" class="node"><title>wall-b</title><polygon fill="none" stroke="black" points="40,105 40,140 110,140 110,105"/><text text-anchor="middle" x="75" y="129" font-size="10.00">底墙</text></g>
</svg>`
    const { svg: out, warnings } = annotateSvgWithLeaderLines(svg, [{ label: '主控板', numeral: '10' }])
    expect(warnings).toEqual([])
    // 右上斜向：自角点 (100,50) 沿 45° 外向 gap*√½≈7.1 → (107.1,42.9)。
    expect(out).toContain('<line x1="100" y1="50" x2="107.1" y2="42.9"')
    expect(out).not.toContain('主控板 (10)')
  })
})
