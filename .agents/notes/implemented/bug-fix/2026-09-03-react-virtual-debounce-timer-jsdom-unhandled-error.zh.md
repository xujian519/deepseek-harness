# Agent Note: 升级 react-virtual，修复存活超过 jsdom 环境的防抖定时器

Status: implemented

[English](2026-09-03-react-virtual-debounce-timer-jsdom-unhandled-error.md) | 中文

## 问题

CI 的 unit-test 步骤以退出码 1 失败，但所有测试通过——`22635 passed | 8 skipped`，零失败。Vitest 汇总里才是真正的信号：

```
Vitest caught 1 unhandled error during the test run.
Uncaught Exception
ReferenceError: window is not defined
  ❯ getCurrentEventPriority react-dom/cjs/react-dom.development.js:10993
  ❯ Object.onChange @tanstack/react-virtual/dist/esm/index.js:81
  ❯ Timeout._onTimeout @tanstack/virtual-core/dist/esm/utils.js:65
This error originated in "packages/client/ui-trajectory/tests/table.client.spec.tsx".
```

`@tanstack/virtual-core` 3.17.7 安装的 scroll 监听器里，`isScrollingResetDelay` 防抖会为每次滚动事件排队一个 `setTimeout`。它的 `observeOffset` 清理只移除了事件监听器；防抖句柄是闭包局部变量，排队中的回调在 spec 的 `afterEach` 执行 `cleanup()` 之后仍然存活。该测试文件在 150 ms 延迟流逝之前就结束了——35 个测试全部通过——Vitest worker 继续运行并拆除了 jsdom 环境。排队回调随后 fire 时，走进表格的 `onChange` 进入 React 的 `dispatchReducerAction`，而 react-dom 的 development 构建裸引用 `window` 全局变量，它已不存在。未捕获异常使整个 unit-test 通道以退出码 1 结束。

单独运行该 spec 永远无法复现：那里环境比定时器活得久，对已卸载组件的 dispatch 是 React 的 no-op。只有全量测试的 worker 拓扑——环境死在文件结束与定时器 fire 之间——才会暴露它，这就是失败看似随机的原因。

## 决策

把 `packages/client/ui-trajectory/package.json` 中的 `@tanstack/react-virtual` 从 `^3.14.9` 升级到 `^3.14.10`，引入 `@tanstack/virtual-core` 3.17.8。

3.17.8 正是修复了这个泄漏：防抖包装器获得了 `cancel()` 句柄，`observeOffset` 的清理会调用它，在调用方取消订阅后丢弃排队的调用。卸载后迟到的 `onChange` 在任何环境中都无法再触发。

## 已考虑的替代方案

**在测试 teardown 中冲刷防抖延迟。** 在 spec 的 `afterEach` 里等满 `isScrollingResetDelay` 可以在环境死亡前排干定时器。拒绝：它让库的每个使用方为上游的一个清理缺口付费，为测试不拥有的产品问题拖慢测试套件，且泄漏仍在原处，等下一次 Vitest 拓扑变化再次暴露。

**让 Vitest 忽略未处理错误。** 设置 `dangerouslyIgnoreUnhandledErrors` 会让通道变绿。拒绝：它静音今后每一个未处理异常，而这次事故恰恰表明测试套件需要这类信号。

## 后果

`ui-trajectory` 是唯一依赖 `@tanstack/react-virtual` 的包，因此锁文件变化被限定在轨迹表格的依赖子树内；virtual-core 3.17.8 上它的 9 个测试文件（134 个测试）与全仓 typecheck 通过。

unit-test 通道以退出码 1 结束且零测试失败时，现在有一条已知的首选诊断：先读 Vitest 的 "Unhandled Errors" 摘要，再把这次运行当作 flaky。任何 jsdom spec 的环境都可能在一个第三方定时器仍排队时被拆除，都可能产生这一类失败。
