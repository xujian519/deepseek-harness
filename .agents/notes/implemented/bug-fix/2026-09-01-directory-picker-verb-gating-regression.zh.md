# Agent Note: 目录选择器的 wire 动词按动词放行，而非按 capability kind

Status: implemented

[English](2026-09-01-directory-picker-verb-gating-regression.md) | 中文

## 问题

在打包后的桌面 app 中点击「增加工作区」失败：

```
directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "electron"
```

`DirectoryPickerController.pick` 通过 `requireCapability('native', 'pick')` 取后端，该方法把 `capability.kind` 与 `native` 字面量相比较。桌面组合由 `ElectronDirectoryPicker` 注册 `ctx.directoryPicker`，其 capability kind 为 `electron`，于是每次 pick 都以 `directory-picker/unavailable` 被拒。

`DirectoryPickerCapabilities` 是 merge-extensible 的：`electron` 仅从 `packages/desktop/directory-picker/src/index.ts` 声明合并进该缝，编译该控制器的 Host 程序没有它的类型，所以那里的 kind 比较永远不可能放行它。把 merge-extensible 联合当作封闭联合处理，正是仓库约定所禁止的——这类联合应当走文档化的默认分支。

这回归了 [2026-08-25](2026-08-25-desktop-surface-patch-handoff-and-picker.zh.md) 已记录的决策。那份 note 已在当时的 `host.pickDirectory` RPC 中把同一个 `native` 字面量换成了 `if (!('pick' in capability))`。两天后的 Remote 迁移从零写出 `DirectoryPickerController`，字面量比较复活；随后删除 apiproxy 的 RPC 时，存在性检查一并消失。该控制器的 spec 只覆盖了 browse 组合拒绝 `pick`，没有任何用例断言「Host 程序无法命名、但具备 pick 能力的后端应被服务」，因此回归静默落地。

桌面组合本身从无问题：`packages/bundle/desktop-app/cordis.patch.yml` 正确禁用了 auto 行，并把 electron provider 与 native 客户端表面一起钉死。

## 决策

每个 wire 动词按其转发的原语是否存在放行，而非按 kind 字面量。

`requireCapability` 只接收动词，其类型收窄到该交互自身的成员；调用方通过显式类型参数点明交互：

```ts
private requireCapability<Kind extends keyof DirectoryPickerCapabilities>(
  method: Exclude<keyof DirectoryPickerCapabilities[Kind], 'kind'> & string,
): DirectoryPickerCapabilities[Kind] {
  const capability = this.ctx.directoryPicker.capability()
  if (!(method in capability)) throw new RemoteError('directory-picker/unavailable', ...)
  return capability as DirectoryPickerCapabilities[Kind]
}
```

把 `method` 的类型钉在 `DirectoryPickerCapabilities[Kind]` 上，使运行时的存在性检查无法与它所守的动词漂移：原语一旦改名，编译即失败，而不是在运行时才拒绝。

拒绝文案改为陈述后端实际提供什么，不再断言所需 kind：`the composed picker serves "browse", which does not provide directoryPicker.pick`。`directory-picker/unavailable` 代码及其 `{ capability }` 明细不变，客户端的分支判定不受影响。

各 capability 的行为：`native` 与 `electron` 服务 `pick`；`browse` 服务 `list` 与 `createDirectory`；其余配对一律拒绝，未来任何一个都不提供的新 kind 亦然。

## 备选方案

**把 `electron` 折叠进 `native`。** 两者动词相同、返回契约相同，合为一个 kind 可从源头消除不匹配。否决：二者的中止行为确有差异——native 选择器在 abort 时终止，而 Electron 未暴露编程关闭手段，其对话框会一直开到操作者动手为止——且该缝把 kind 定义为消费方可见。折叠还会削弱这条缝赖以成立的 merge-extensible 注册表，却没有修掉真正的约定违规：精确匹配比较本身。

**保留 kind 比较，把 `electron` 加进 Host 程序的联合。** 否决：Host 程序不依赖 `packages/desktop/*`，为满足一次比较而把桌面声明引入其中，会把该缝的依赖方向倒置。

**保留 `kind` 形参用于类型推导。** 否决：判定改为结构化后 `kind` 无人读取，`noUnusedParameters` 会拒绝它。显式类型参数同样在调用点点明了交互，且不留死参数。

## 后果

桌面「增加工作区」重新打开 Electron 选择器。今后任何合并进该缝的后端，都会按其提供的动词被服务，无需改动控制器——这正是 2026-08-25 决策意图达成、而本次改动予以恢复的性质。

`packages/api/workspace-controller/tests/directory-picker.host.spec.ts` 现在用一次 cast 构造 electron 形状的 capability 桩（Host 程序没有该 kind 的类型，这正是被测条件），并断言 `pick` 能应答它。该用例就是迁移时缺失的守护：它在 kind 比较下失败，且失败信息与操作者所见完全一致。

桌面 app 跑的是部署进 `apps/desktop/resources/<os>/backend` 的 `lib` 构建快照，因此本修复只有经 `pnpm run package:desktop:mac` 重新打包并覆盖安装才能到达操作者，源码侧测试通过并不代表生效。
