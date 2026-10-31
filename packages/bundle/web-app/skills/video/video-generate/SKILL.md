---
name: video-generate
description: |
  逐镜生成关键帧与视频片段：先估成本再提交，关键帧优先、图生视频兜底；
  每次生成写入独立目录，并把选中片段与成本写回项目。
whenToUse: 分镜与资产确认后，生成图像或视频镜头时。
---

# Video Generate（逐镜生成）

一次只处理一个镜头。先生成关键帧，再决定是否图生视频；不要在未估成本时批量提交。

## 单镜流程

1. 用 `media` 的 `models` 确认可用模型与价格。云端视频有两条路径：`MiniMax-H3` 按生成秒数计费、支持 4–15 秒与 768P/2K；SiliconFlow 的 `Wan-AI/Wan2.2-I2V-A14B` 按条计费、固定 5 秒、只做图生视频。本地 `wan2.2-ti2v-5b` 可作为备用；关键帧默认由本地 `z-image-turbo` 生成。
2. 用 `media` 的 `estimate` 估算该镜头的成本与时长；超过 10 元或超出剩余预算时先问用户。
   每次 `generate` 都带上 `project_path`，工具会按项目剩余预算硬拦截；超过 10 元的生成在用户确认后加 `confirm_cost: true` 重试。
3. 生成关键帧：

   ```text
   media { action: "generate", kind: "image", prompt: "...", aspect_ratio: "9:16", output_path: "shots/s01/start.png", project_path: "video/<id>/project.json" }
   ```

4. 生成视频片段，把关键帧作为首帧传入。MiniMax-H3、SiliconFlow Wan2.2 与本地 ComfyUI 都支持首帧图生视频；本地 Wan 在 Apple MPS 上即使传了首帧，480p 片段数秒内仍会拖影漂移，只作草稿。单镜 5 秒且预算优先时用 `Wan-AI/Wan2.2-I2V-A14B`（每条 2 元，省略 `duration_sec` 或传 `5`）；需要 4–15 秒或 2K 时用 `MiniMax-H3`。两者都传首帧以保持跨镜一致。

   ```text
   media { action: "generate", kind: "video", model: "Wan-AI/Wan2.2-I2V-A14B", prompt: "...", aspect_ratio: "9:16", first_frame_path: "shots/s01/start.png", output_path: "shots/s01/clip.mp4", project_path: "video/<id>/project.json" }
   ```

   若返回运行中任务（`submitted` / `running`），用 `media status` 带同一 `output_path` 与 `project_path` 反复读取；进程重启后，工具会按项目日志把任务接回并继续轮询。云端 H3 通常需要数分钟，本地 Wan 在 Apple 芯片上更久；可以先处理其他镜头再回来查。H3 的 `duration_sec` 只接受 4–15 的整数，分辨率只接受 `768P` 或 `2K`。SiliconFlow 没有取消接口，`media cancel` 只停止本地轮询，远端任务仍可能完成并计费。

   ```text
   media { action: "generate", kind: "video", model: "MiniMax-H3", prompt: "...", duration_sec: 4, resolution: "768P", aspect_ratio: "9:16", first_frame_path: "shots/s01/start.png", output_path: "shots/s01/clip.mp4", project_path: "video/<id>/project.json" }
   ```

5. 用 `video_project` 的 `upsert_shot` 把 `keyframe_path`、`clip_path`、`provider`、`model`、`cost_cny` 与 `status: "ready"` 写回。
6. 生成失败时保留错误与已花费成本；重试前先说明原因，不静默连抽。

## 目录约定

```text
shots/s01/start.png
shots/s01/end.png
shots/s01/clip.mp4
shots/s01/prompt.txt
```

## 检查清单

- [ ] 每个镜头先生成关键帧，再生成视频
- [ ] 视频片段的 `first_frame_path` 指向该镜头关键帧
- [ ] 每次生成都有估算与结果记录
- [ ] 单镜头失败不阻塞其他镜头；失败原因进入交付摘要
- [ ] 项目中的成本与预算同步（媒体账本会自动记账，`cost_cny` 仍写回供项目汇总）
- [ ] 用户确认过超预算或超阈值的生成
