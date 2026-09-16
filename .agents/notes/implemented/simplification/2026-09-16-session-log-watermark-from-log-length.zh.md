# Agent Note: 会话日志上传水位改由日志长度派生

Status: implemented

[English](2026-09-16-session-log-watermark-from-log-length.md) | 中文

## Problem

准备一次 `dsh_session_log` 请求贡献时，为了得到一个数字读取了整份规范日志。`prepare` 调用 `session.snapshotEvents()`——对每条事件的复制并冻结——却只用到 `.at(-1)?.seq`，也就是该字段上报的水位。`Session.append` 每次追加都会清空那份缓存快照，因此复制不是每个会话一次，而是每次准备请求都发生一次：在 90,000 条事件的日志上实测每次请求 0.04 ms，也就是说每次请求约 0.7 MB 的数组垃圾，而在请求延迟中不占可测量的比例。该调用同时还是延迟迁移的 `typescript/no-deprecated` 读取者之一。

## Decision

- `throughSeq` 取 `session.seq - 1`，经 `SessionSeq` 收编。日志长度的连续性契约使日志长度等于下一个未读序号，因此最后一条已追加事件的序号就是该值减一。
- 空日志在读取前返回 `undefined`，保持此前“字段缺失”的语义（`snapshot.at(-1)?.seq === undefined`）。
- 后缀读取保留：`session.snapshotEvents(SessionLogOffset(afterSeq + 1))` 只复制未接受的尾部，而这是该字段必须携带的内容。
- 被删除调用的 `typescript/no-deprecated` 豁免随之一并删除。

## Alternatives considered

- **新增 `Session.lastSeq` 访问器。** 已否决：`session.seq` 已经公布日志长度，另有四个包同样由它派生最后序号。
- **保留快照调用，改读会话自身的缓存快照。** 已否决：缓存确实存在，但 `append` 在每条事件上都会使其失效，因此逐请求调用者必然错过它。
- **把水位与接受水位折叠放在一起缓存。** 已否决：折叠缓存的 `scannedEvents` 随追加推进，缓存下来的水位会被同一批追加失效——派生值本身不需要缓存。

## Consequences

上传的字段体不变：`throughSeq` 相同、后缀相同、`accept()` 写入的接受记录相同。该插件不再读取完整事件序列，这条路径的弃用读取迁移至此完成。

## Testing

- `packages/session/session-log-deepseek/tests/upload.spec.ts` 新增一个用例，在“一次已接受请求加一次后续追加”的范围内对 `Session.snapshotEvents` 打点：剩下的唯一一次调用是位于未接受偏移处的后缀读取。
- 负向控制（已运行并回退）：恢复快照读取只会让该用例失败（`expected [ [], [ 2 ] ] to deeply equal [ [ 2 ] ]`），同文件另外 28 项仍然通过。
- `pnpm exec vitest run packages/session/session-log-deepseek/tests` —— 44 项通过。`pnpm exec vitest run packages/llm/llm-deepseek/tests/loader-composition.spec.ts` —— 7 项通过，覆盖挂载该插件的 adapter 启动。
- 请求字段本身不被录制，但该插件追加的接受事件携带同一个 `throughSeq`，而有三个录制场景包含它们。`pnpm run test:snapshot -t text-turn`、`-t subagent-dsh-sdk-diagnostic`、`-t serial-created` 均在期望输出不变的情况下回放通过。

## Related

- [弃用同步会话事件读取](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md) —— 禁止新增读取者、并要求在删除调用时一并删除豁免的决定。
- [session-log-deepseek](../../../../packages/session/session-log-deepseek/README.zh.md) —— 拥有该字段及其接受水位的插件。
