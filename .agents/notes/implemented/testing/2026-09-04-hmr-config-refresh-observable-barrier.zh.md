# Agent Note: HMR 配置刷新可观测状态屏障

Status: implemented

[English](2026-09-04-hmr-config-refresh-observable-barrier.md) | 中文

## 问题

`packages/boot/app-boot/tests/hmr-config.spec.ts` 的配置刷新用例通过 chokidar 观察真实文件系统事件，其中两个用例在 CI 并发下间歇失败。

`serializes refreshes and waits for them during disposal` 用例写入第二版文件后固定 sleep 250 ms 再调用 dispose。dispose 会先关闭 chokidar watcher 再等待运行中的刷新，因此在并行负载下变更事件若在该窗口之后到达，编辑从未入队，`observed` 停在 `['one']` 而非 `['one', 'two']`。

`observes add, change, and unlink outside its module roots` 用例依赖 `eventually` 默认的 10 s 预算，低于单元测试 lane 的 `--testTimeout 90000`。因此被争抢的宿主机让一个安静宿主机可过的用例失败。

两者都属于负载敏感同步：固定 sleep 或低于 lane 的预算，替代了对测试所断言文件系统事件的可观测就绪判断。可靠性 Skill 将其归类为负载敏感同步而非产品并发缺陷；已交付的刷新序列化器本身是正确的。

## 决策

`serializes refreshes and waits for them during disposal` 用例用对可观测状态迁移的等待替换固定 250 ms sleep。刷新回调现在在第二个刷新实际启动时 resolve 一个 `secondStarted` 承诺，测试在 dispose 前等待该承诺。由于 dispose 被推迟到第二个刷新开始之后，慢速文件系统事件只会延迟排空，而不会在 watcher 关闭后丢失变更；序列化器会在 dirty 标志置位时于同一运行中的任务里重跑该刷新，绝不并行。该用例还用 `release2` 门栓持有第二个刷新，使 dispose 可证明地在等待在飞刷新，并保留每个原始断言：`maxActive === 1`、dispose 先未解析后解析、`observed === ['one', 'two']`。

`observes add, change, and unlink` 用例给每个 `eventually` 等待显式传入 20 s 预算，并把用例超时抬高到 lane（90 s），取代低于授予预算的默认 10 s。

变更限定在这两个用例；不改产品源码、vendor 插件或配置。

## 测试

两个用例在单进程 app-boot 套件中持续通过，`serializes` 用例在超出 CI 拓扑的六路并行进程压力下仍然保持绿色。宿主 `tsc -b tsconfig.host.json` 无错误，oxlint 对改动文件报告零警告。

## 考虑过的替代方案

**增大固定 sleep 或增加重试循环。** 更大的 sleep 或在 dispose 周围加重试仍然不标识等待状态，而且一旦 dispose 关闭 watcher，重试也无法挽回，因为编辑已经丢失。这正是可靠性 Skill 拒绝的掩盖式修复模式。

**通过测试自己持有的另一个 watcher 来同步。** 从测试侧监听同一路径，其投递上下界不如屏障在插件自身提交点上可靠，因为两个 watcher 不共享同一条投递队列，在负载下可能产生分歧。

**从 vendor 插件暴露序列化器的 dirty 状态或变更事件。** 在 `vendor/hmr` 加入钩子会让入队状态可观测，但修改 vendor 源码需走同步流程并重放已记录的本地修改，只为一个测试收益不值得。

**把用例切换到 polling watcher。** Polling 把检测限制在一个间隔内，但没有消除观察编辑已被接受的需求；它仍需要状态屏障，且改变了被测的检测机制。

## 后果

这两个用例不再依赖墙钟 sleep 或低于 lane 的预算，因此被争抢的宿主机只会延迟刷新的完成，直到可观测状态到达，而不是错误失败。代价是产出无效的运行会按预算而不是立即报告：`observes` 用例每个事件最多 20 s，`serializes` 用例最多到用例超时，在宿主机争抢严重时可能耗尽整个 lane。产品行为与 vendor 刷新序列化器保持不变。
