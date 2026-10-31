---
name: video-voice
description: |
  为视频生成配音、BGM 与字幕：用 MiniMax 语音逐句合成配音、记录音色与授权、输出单调时间轴的 SRT，
  并给出响度与混音参数。没有语音 provider 时降级为字幕卡并明说。
whenToUse: 镜头生成完成、合成之前。
---

# Video Voice（配音、BGM 与字幕）

声音先于画面混音：先得到每句台词的音频与时长，再排字幕与镜头节奏。

## 配音

1. 先估算：`media { action: "estimate", kind: "speech", prompt: "第一句台词" }`；语音按字符计费，成本通常远低于视频。
2. 按台词切分，一次合成一句或一个镜头的一段：

   ```text
   media { action: "generate", kind: "speech", prompt: "第一句台词", voice: "Chinese (Mandarin)_News_Anchor", subtitles: true, output_path: "voice/s01-01.mp3", project_path: "video/<id>/project.json" }
   ```

   默认模型是 `speech-2.8-turbo`（2.00 元/万字符）；需要更高音质时把 `model` 设为 `speech-2.8-hd`（3.50 元/万字符）。生成结果按项目剩余预算拦截，并返回实际成本。`subtitles: true` 会同时写出 `voice/s01-01.srt`，时间轴来自 provider 的词级时间戳；结果里的 `subtitlesPath` 就是该文件。
3. 音色在 brief 中定一次，全片复用；多角色时每个角色一个固定音色。常用普通话音色：`Chinese (Mandarin)_News_Anchor`（口播）、`female-chengshu`（成熟女声）、`male-qn-qingse`（青年男声）。
4. 用 `ffprobe` 读取每段音频的时长，按实际时长排镜头节奏；字幕直接用上一步写出的 SRT。把音色、provider、时长与成本写回项目或脚本。
5. 部署没有语音 provider 时，说明“本部署没有语音合成”，改用字幕卡，不伪造音频；没有词级时间戳时按音频实测时长均分，并说明这是估算。

## BGM 与授权

- BGM 必须由用户提供或来自明确授权的素材库；记录来源与授权范围。
- 没有授权记录时不得混入成片；`video_deliver` 只检查文件、时长、画幅与预算，授权结论由你在交付摘要中声明。

## 字幕

1. 优先使用 `media` 写出的 SRT（`voice/<shot>.srt`），按镜头顺序拼接为 `out/<project>.srt`；每行不超过 16 个汉字，最多两行，超长时自行拆分。
2. 时间轴来自 provider 的词级时间戳；provider 没有返回时间戳时按音频实测时长均分，并说明这是估算。
3. 默认烧录字幕；`libass` 或 CJK 字体缺失时改为软字幕，并在交付摘要中标注平台可能不识别。

## 混音参数

- 对白为主轨，BGM 默认 `-12 dB`，有对白时 Ducking。
- 整体响度 `-14 LUFS`，真峰值 `-1.5 dBTP`。
- 交付前用 `ffprobe` 或 `video_deliver` 确认有音轨；`video_deliver` 对无音轨给出警告，不校验 BGM 授权。

## 检查清单

- [ ] 每句台词有音频或明确的降级说明
- [ ] 音色全片一致，多角色映射清晰
- [ ] BGM 来源与授权已记录
- [ ] SRT 时间轴单调、无重叠、每行不超长
- [ ] 响度与真峰值符合目标
