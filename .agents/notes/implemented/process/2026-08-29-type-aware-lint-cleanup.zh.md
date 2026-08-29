# Agent Note: 类型感知 lint 清理区分死代码与类型盲防御

Status: implemented

[English](2026-08-29-type-aware-lint-cleanup.md) | 中文

## 问题

better-sidebar 的 66k 行新代码累积了 226 个类型感知 lint 错误(oxlint `typescript/*` 规则:`no-base-to-string` 79、`no-unnecessary-condition` 40、`no-unsafe-assignment` 25、`unbound-method` 23、`no-redundant-type-constituents` 15,另有 18 条规则)。它们都不是编译错误,`tsc` 不给任何信号;但每一条要么掩盖了真实的类型缺陷,要么训练读者无视 linter。错误集中在测试文件(161),其余在 `src`(65)。`src` 部分包含 `no-unnecessary-condition` 的「该分支恒假」报告——直接删分支,对错参半。

## 决策

按**运行时契约**清理,而不是只看声明类型。每条 `no-unnecessary-condition` 在改动前先做可达性判定,判定结果分四类、各有不同修法:

- **控制流窄化对回调改写的状态失明**(`let flag = false` 在 `mapLeaf`/`forEach` 回调里或跨 `await` 被置真)。类型检查器的值域看不见写入者。在声明处(`= false as boolean`)或读取处(`flag as boolean`)打断窄化——行为零变化,断言本身就记录了「这个变量运行时多态」。
- **jsdom 防御分支**(`HTMLElement.prototype.setPointerCapture?`、`window.visualViewport`、`event.dataTransfer?`)。lib.dom 声明成员恒在,jsdom 说不,且组件测试故意派发不带 `dataTransfer` 的事件。这些保留可选链,加一行 `oxlint-disable-next-line` 注明环境缺口——分支是承重的。
- **不全的 wire 形状断言**(`data.chunk as {...} | undefined` 而 JSON 可以是字面 `null`;ws `RawData` 没有共享的 utf8 `toString`)。修断言或加收窄 helper(`frameText`),绝不删守卫。
- **真正的死检查**(解析后文档的 `documentElement === null`、第二个 `?? undefined` 比较、对已是 string 的值套 `String()`)。删除。

仅测试用的 fetch mock 按真实调用面标注类型,而不是照抄环境 `fetch` 签名:api 层只发字符串路由和字符串化 JSON,所以 stub 收窄为 `(url: string, init?: RequestInit)`,用 `postedJson`/`matchers.ts` helper 替代 `JSON.parse(String(init?.body))` 和对象字面量位置返回 `any` 的非对称匹配器。原型保存/恢复在成员存在时用 `vi.spyOn`(jsdom 缺失的 `scrollIntoView` 需要先赋值后 delete 的形状——`vi.spyOn` 要求自有成员,否则抛错)。作为恢复用身份锚点的 unbound-method 引用(open-path 的 HMR 包装)用窄化 disable;凡是之后会被**调用**的引用一律改 `.bind()` 或箭头透传。

## 已否决的替代

- **在 oxlint 配置里对 `tests/**` 关掉这五条规则。** 否决:测试文件自身也有真实缺陷(any 类型的 mock 会让改名后的 wire 字段悄悄漏过),而且全局开关会把逐点 disable 所呈现的「jsdom 防御」区分一并藏掉。
- **删除规则报告的每个恒假分支。** 否决:四十条里有两条(logger 可选链、visualViewport 检查)在测试模拟的环境中恰恰可达;一刀切删除在人工判定跟上之前弄挂了 73 个测试。

## 后果

- 该包 `pnpm run lint` 清零;仓库剩余 warning 是既有 `memory/openviking` 测试 warning,不在本次范围。
- `oxlint-disable` 注释是承重文档:每条都写明环境缺口或身份锚点理由。未来 jsdom 升级实现了 `visualViewport` 或 `setPointerCapture` 时,应把配对的防御与 disable 一起删除。
- 窄化的 `any` 出口现在集中在 `tests/matchers.ts` 一个类型化文件;新的非对称匹配器应扩展它,而不是在对象字面量里重新内联 `expect.any`。
- 类型层面的 workaround(`false as boolean`、`textRender` 擦除器里的 `value as never`)是「检查器看不见写入者」时的刻意形状;当重写能保持行为不变时,优先重构成 `some()`/提前返回。
