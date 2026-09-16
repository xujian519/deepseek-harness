# Agent Note: 一次扫描同时供给网关的 SRC 声明集与描述符查找

Status: implemented

[English](2026-09-16-gateway-remote-service-scan.md) | 中文

## 问题

`TypertGatewayService` 用同一段六步前缀走了两遍 `ctx.reflect.props`：枚举属性、保留 `definition.type === 'service'`、把 `this.ctx.get(serviceKey)` 读作接收者、保留对象、经 `originalOf` 解包、从原件读出 `typertRemote`。`collectSrcClaims` 用该值枚举活跃 Service 声明的全部 Remote 端点；`resolveSrcDescriptor` 用该值找出回答某个 namespace 与 method 的那一个描述符。

两个循环只在这段前缀之后分叉：声明扫描需要该值是一个暴露字符串 `namespace` 的对象，而描述符解析把它交给 `readBinding`——后者校验整个绑定，并在绑定不一致时抛 `gateway/binding-invalid`。于是「如何发现一个活跃 Remote」的改动必须在两处同时落地，而代码里没有任何东西能让漏掉的第二处显现出来。

## 决策

新增私有生成器 `remoteBindingValues()`，为每个接收者是活跃对象的 Service 产出 `{ serviceKey, original, value }`，其中 `value` 是未加工的 `Reflect.get(original, 'typertRemote')`。`collectSrcClaims` 保留自己的「对象且带 namespace」过滤；`resolveSrcDescriptor` 保留自己的 `undefined` 跳过与 `readBinding` 调用。

因此「是否接受某个候选」留在需要做该判断的消费方：声明扫描可以跳过读不出 namespace 的绑定，而描述符解析必须报告不一致的绑定。生成器产出未加工的值而非已校验的绑定，正因为它无法替两者做这个判断。

## 考虑过的替代方案

**在生成器内校验并产出 `TypertGatewayBinding`。** 否决：校验恰恰是两个消费方分歧所在。带校验的生成器要么在一次只想枚举端点的声明扫描中抛出 `gateway/binding-invalid`，要么吞掉解析必须报告的绑定——两个消费方必有一个要把检查再做一遍。

**改用与其它辅助函数并列的模块级 `function* remoteServices(ctx)`。** 否决：两个消费方都是同一服务上的方法，且只读 `this.ctx`，因此自由函数要把 Context 作为参数传入，把服务内部的遍历搬出类外，却没有消除任何依赖。

**让生成器直接构建声明集，解析方再对该集过滤。** 否决：声明扫描由 `namespace` 加全部 `remoteMethods` 候选派生端点，而解析需要整个绑定并为每个候选构造 `InvocationDescriptor`；共享派生数据会让每次解析都重算声明集。

**把重复登记为「已接受」并保留两个循环。** 否决：两个循环必须同步，活跃 Remote 才可能被寻址，而分叉是静默失败——声明集会漏掉解析仍能服务的端点，或声明解析无法服务的端点。

## 结果

发现活跃 Remote 现在只有一次遍历，因此新增一条发现规则只需落地一次，两个消费方都能看到。

每个消费方在自己的位置写明自己的接受规则，这正是读者所需要的：声明扫描里的跳过与解析里的抛出，都在其被决定的地方可见，而不是折进一个共享辅助函数。

网关的严格定义路径未被触及——经 `ctx.typert.local` 找到的端点从不进入这两处循环。

## 测试

`packages/api/gateway/tests/gateway.host.spec.ts` 通过 SRC 标记抵达两个消费方。网关全套（8 个文件、287 个用例）原样通过，且 `packages/api/gateway/src/index.ts` 在 `vitest --coverage --coverage.include` 下保持语句、分支、函数、行 100%。

## 相关

- [typert 子系统](../../../../docs/subsystems/typert.zh.md)——活跃 Remote 绑定从何而来，以及网关如何处理它。
