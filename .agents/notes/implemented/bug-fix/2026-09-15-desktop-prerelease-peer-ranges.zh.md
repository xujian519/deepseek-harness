# Agent Note: 桌面插件校验接受预发布 peer 范围

Status: implemented

[English](2026-09-15-desktop-prerelease-peer-ranges.md) | 中文

## 问题

`validateDesktopPluginGraph` 用 semver 默认比较规则把每个已启用插件的 peer 范围与宿主包版本比对。默认规则只在范围里存在「主次修订号相同且带预发布标记」的比较器时，才允许预发布版本落入该范围，于是宿主包本身是预发布版的桌面发行会拒绝所有针对同一产品线其它预发布版编写的插件。`@dely0/dsh-personal-workbench` 把 `@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools` 声明为 `^0.1.0-rc.6` 的 peer，打包的 0.1.5-rc.2 宿主抛出：

```
desktop profile: @dely0/dsh-personal-workbench requires @deepseek-ai/dsh-host-webserver@^0.1.0-rc.6, found 0.1.5-rc.2
```

启动时的 profile 协调和每次插件变更都会执行该校验，于是启用这类插件会让 profile 准备失败而不是把它加载起来，应用报出的是启动失败而非「插件未安装」。

## 决策

`validateDesktopPluginGraph` 用 `satisfies(version, range, { includePrerelease: true })` 比较 peer 范围。

预发布版本现在计入宿主的已安装版本，因此预发布宿主发行能满足覆盖它的预发布 peer 范围，而不覆盖该版本的范围仍然失败。该选项只放宽预发布准入：`^0.1.0-rc.6` 接受 `0.1.5-rc.2`，`^0.2.0` 依旧拒绝它。

## 考虑过的替代方案

**安装前改写每个第三方插件的 peer 范围。** 重打成携带 `^0.1.5-rc.2` 的 tarball 能通过默认比较。否决：每个插件、每个 dsh 预发布版各需重打一次，而桌面端的安装入口只接受 npm 仓库规格，重打产物无法经插件窗口安装。

**要求插件作者声明其构建时对应的确切预发布版本。** 否决：那样每个 dsh 预发布版都会让已装插件失效，而 `^0.1.0-rc.6` 已经表达了作者意图的兼容性——同一产品线，后续任意预发布版或正式版。

**接受任意 peer 范围。** 否决：该校验仍须拒绝为其它主版本或次版本产品线构建的插件，且它的诊断是唯一指出越界范围的地方。

## 结果

peer 指向打包宿主包的插件能在同一产品线的各预发布构建间安装并激活，这正是本仓库自身的预发布版本策略所产生的情形。

声明了不覆盖宿主版本的范围的插件仍然以同一条诊断让 profile 准备失败，因此真正不兼容的插件在宿主启动前就会被拦下。

校验会接受预发布宿主落入 `^0.1.0` 这类正式版范围：该比较证明的是范围覆盖已安装版本，而非该版本是正式版。

## 测试

`apps/desktop/tests/profile-packages.spec.ts` 钉住了「预发布宿主发行下通过」以及「排除该版本的预发布范围仍被拒绝」两条路径。该文件其余用例钉住未改动的归属与布局规则。
