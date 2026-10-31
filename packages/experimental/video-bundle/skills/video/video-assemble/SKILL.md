---
name: video-assemble
description: |
  把镜头、配音与字幕编译成 EDL，并用 `video_assemble` 经 ffmpeg 合成 MP4：
  画布归一化、拼接、混音、烧字幕、封面与 faststart。可复现、可重跑。
whenToUse: 所有镜头与音频就绪、需要出成片时。
---

# Video Assemble（EDL 合成）

成片只从 EDL 生成。EDL 是完整、可复现的渲染契约；不要把 ffmpeg 命令直接拼进回复。

## EDL 结构

```json
{
  "version": 1,
  "canvas": { "width": 1080, "height": 1920, "fps": 30 },
  "clips": [
    { "kind": "video", "source": "shots/s01/clip.mp4", "inSec": 0, "outSec": 4 },
    { "kind": "image", "source": "shots/s02/start.png", "durationSec": 3 },
    { "kind": "color", "color": "101820", "durationSec": 1 }
  ],
  "audio": [
    { "source": "audio/voice/s01.mp3", "gainDb": 0 },
    { "source": "audio/bgm/theme.mp3", "gainDb": -12 }
  ],
  "subtitles": "out/ep01.srt",
  "output": "out/ep01.mp4"
}
```

规则：

- `video` 必须有 `outSec`；`inSec` 省略为 0。
- `image` 与 `color` 用 `durationSec`。
- 所有路径相对会话工作目录。
- 字幕存在时默认烧录；字体由部署配置或 `PingFang SC` / `Noto Sans CJK SC` 决定。
- 总时长等于所有视觉片段时长之和；音频短于画面时补静音。

## 流程

1. 从 `video_project` 读取镜头与选中片段，生成 EDL。
2. 调用 `video_assemble`，传入完整 EDL；输出必须是 `out/` 下的新文件。
3. 读取返回的时长、分辨率与音轨；与 brief 对比，偏差超过 10% 先修正。
4. 用 `ffmpeg` 或 `media` 无关的本地工具抽封面；封面写入 `out/<project>-poster.jpg`。
5. 进入 `video-deliver`。

## 检查清单

- [ ] EDL 覆盖全部镜头，顺序与分镜一致
- [ ] 画布、帧率、画幅与 brief 一致
- [ ] 有音轨；字幕已烧录或明确声明软字幕
- [ ] 输出文件在 `out/` 下，文件名稳定
- [ ] 合成命令与实测结果已记录
