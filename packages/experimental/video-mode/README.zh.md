---
description: "实验性视频模式：媒体 provider 能力缝、持久项目文档、由 ffmpeg 渲染的可复现 EDL、四个模型工具、确定性合成 provider、渲染 Wan 2.2 视频与 Z-Image 图像的本地 ComfyUI provider，以及云端 MiniMax-H3 视频与 MiniMax 语音 provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-video-mode

[English](README.md) | 中文

## 概述

本包是视频模式的第一个 Host 切片。它提供 `ctx.media`（图像、视频、语音生成的 provider 注册表）、`video/<id>/project.json` 持久项目文档、经校验并由 ffmpeg 渲染的编辑决策表（EDL），以及四个模型工具：`media`、`video_project`、`video_assemble`、`video_deliver`。随包提供四个 provider：无需凭据的确定性合成 provider、在本机渲染 Wan 2.2 TI2V-5B 视频与 Z-Image Turbo 图像的本地 ComfyUI provider、向 MiniMax API 提交视频任务的云端 MiniMax-H3 provider，以及经 T2A 接口合成口播的云端 MiniMax 语音 provider。

## 目录

- [挂载内容](#what-it-mounts)
- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-mounts"></a>
## 挂载内容

- **`ctx.media`** —— 能力缝的 provider 注册表与统一执行路径。它按配置的默认模型或显式 `model` 选择 provider，在执行时解析模型，用稳定的 `MediaFailure` 码拒绝不可用与歧义选择，保留有界数量的任务记录，并最多等待 `waitMs` 让任务结算。
- **`media` 工具** —— 一个按 action 分派的工具（`models`、`estimate`、`generate`、`status`、`cancel`）：列出模型与价格、预估成本、提交生成、通过 `ctx.fs` 写入产物，以及读取或取消任务。
- **`video_project` 工具** —— 创建、读取与修改项目文档。每次修改先校验完整文档再写入；项目文件是镜头、选中片段、成片与预算的唯一事实源。
- **`video_assemble` 工具** —— 校验 EDL，经 ffmpeg 以归一化滤镜图渲染（画布、帧率、等比补边、拼接、混音、烧字幕、faststart），返回实测时长、分辨率与是否有音轨。
- **`video_deliver` 工具** —— 登记最终文件并返回机器检查。缺视频、镜头不完整、视频无可读流、上报成本超预算会拒绝登记；时长偏差与缺音轨只告警。
- **合成 provider** —— 确定性的 PNG、WAV、MP4 素材与固定价格。由 `fakeProvider: true` 启用。
- **ComfyUI provider** —— 向本地 ComfyUI 提交 API 格式工作流，轮询其历史记录，下载产物文件，并以内联字节结算任务。随包工作流渲染 Wan 2.2 TI2V-5B 视频与 Z-Image Turbo 图像；`comfyui.video.workflowPath` 与 `comfyui.image.workflowPath` 可换成部署自有工作流。本地算力没有按次计费，因此预估成本恒为 0 元。
- **MiniMax provider** —— 向 `https://api.minimax.cn/v2/video_generation` 提交一个 MiniMax-H3 视频任务，轮询 `/v2/query/video_generation/<id>`，下载结算后的 MP4，并以内联字节返回。支持文本、首帧、尾帧与参考图输入；本地图片以 data URI 传输。预估算使用公布的元/秒价：768P 每秒 0.50 元，2K 每秒 0.80 元。
- **MiniMax 语音 provider** —— 向 `https://api.minimax.cn/v1/t2a_v2` 发送一次同步语音合成请求，并以内联 MP3 字节结算。它与父级 `minimax` 共用凭据与 API 源，单次请求可指定任意系统音色，默认使用 `speech-2.8-turbo` 与 `Chinese (Mandarin)_News_Anchor`。一个汉字按两个字符计费；公布价格为 `speech-2.8-turbo` 每万字符 2.00 元、`speech-2.8-hd` 每万字符 3.50 元。请求带 `subtitles: true` 时还会下载 MiniMax 的词级时间戳文件并返回字幕行；`media generate` 将其写成音频旁的 `.srt`。

<a id="use-this-package"></a>
## 使用本包

在同时提供 `ctx.tools`、`ctx.fs`、`ctx.subprocess` 的组合中挂载：

```yaml
- id: video-mode
  name: '@deepseek-ai/dsh-experimental-video-mode'
  config:
    fakeProvider: true
    waitMs: 30000
    ffmpegPath: ffmpeg
    ffprobePath: ffprobe
```

视频模式预设则在本机生成关键帧、在云端生成视频：

```yaml
- id: video-mode
  name: '@deepseek-ai/dsh-experimental-video-mode'
  config:
    fakeProvider: false
    imageModel: z-image-turbo
    videoModel: MiniMax-H3
    speechModel: speech-2.8-turbo
    comfyui:
      enabled: true
      baseUrl: http://127.0.0.1:8188
      image:
        size: 1024
    minimax:
      enabled: true
      apiKeyEnv: MINIMAX_API_KEY
      resolution: 768P
      aspectRatio: 9:16
      speech:
        enabled: true
        model: speech-2.8-turbo
        voiceId: Chinese (Mandarin)_News_Anchor
```

MiniMax 前置条件：通过 credentials 服务保存 `MINIMAX_API_KEY`，或将其导出到环境，且账号或 M Plan 具备 H3 视频权限。预设通过 `minimax.apiKeyEnv` 命名该凭据引用；provider 每次请求都重新解析，因此轮换密钥无需重启。缺少密钥时预设仍可使用 ComfyUI，MiniMax 请求会返回保存或导出 `MINIMAX_API_KEY` 的修复提示；密钥未授权或余额不足会在首次提交时返回 provider 的错误消息。MiniMax-H3 支持 768P 或 2K、4–15 秒的片段；传入首帧或尾帧时 `ratio` 强制为 `adaptive`。

语音 provider 使用同一把密钥与同一个 API 源。账号需要具备语音合成权限；缺少权限时首次语音请求会返回 provider 的错误消息。语音请求为同步调用，单次最多 10,000 字符，长口播按句或按镜头拆分。缺少密钥时返回与视频相同的修复提示，预设仍可启动并完成图像与视频工作。

ComfyUI 关键帧前置条件：0.38 或更新版本可从 `comfyui.baseUrl` 访问，且 `models/` 下已放置 Z-Image Turbo、`qwen_3_4b` 文本编码器与 `ae.safetensors`。显式选择 `wan2.2-ti2v-5b` 的部署才需要 Wan 2.2 文件。缺少文件会在首次提交时以 ComfyUI 的节点错误失败；配置中的文件名写错也同样失败。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `fakeProvider` | `true` | 挂载合成 provider。接入真实 provider 时设为 false。 |
| `imageModel` | `synthetic/image` | 默认图像模型 id。 |
| `videoModel` | `synthetic/video` | 默认视频模型 id。 |
| `speechModel` | `synthetic/speech` | 默认语音模型 id；视频预设设为 `speech-2.8-turbo`。 |
| `speechModel` | `synthetic/speech` | 默认语音模型 id。 |
| `waitMs` | `30000` | `media generate` 在返回运行中任务 id 前的最长等待。 |
| `pollMs` | `250` | 等待期间的轮询间隔。 |
| `maxArtifactBytes` | `536870912` | 单个产物的大小上限。 |
| `maxTasks` | `64` | 保留的任务记录数。 |
| `ffmpegPath` | `ffmpeg` | ffmpeg 可执行文件名或路径。 |
| `ffprobePath` | `ffprobe` | ffprobe 可执行文件名或路径。 |
| `syntheticLatencyMs` | `0` | 合成 provider 结算前的延迟。 |
| `subtitleFont` | 空 | 烧字幕使用的字体族；空表示使用 ffmpeg 默认值。 |
| `approvalThresholdCny` | `10` | 单次生成估算超过该值时需要 `confirm_cost` 与用户确认。 |
| `comfyui.enabled` | `false` | 挂载本地 ComfyUI provider。 |
| `comfyui.baseUrl` | `http://127.0.0.1:8188` | ComfyUI 的 HTTP 地址。 |
| `comfyui.pollMs` | `2000` | 同一任务两次历史轮询之间的最短间隔。 |
| `comfyui.timeoutMs` | `3600000` | 从提交开始计算的失败期限。 |
| `comfyui.outputPrefix` | `dsh` | 服务端写入的输出子目录。 |
| `comfyui.video.model` | `wan2.2-ti2v-5b` | 暴露给调用方的视频模型 id。 |
| `comfyui.video.workflowPath` | 空 | API 格式工作流文件；空则使用随包的 Wan 2.2 图。 |
| `comfyui.video.checkpoint` | `wan2.2_ti2v_5B_fp16.safetensors` | `models/diffusion_models` 下的 UNET 文件名。 |
| `comfyui.video.textEncoder` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders` 下的文本编码器。 |
| `comfyui.video.vae` | `wan2.2_vae.safetensors` | `models/vae` 下的 VAE。 |
| `comfyui.video.resolution` | `480p` | 画布短边，形如 `<n>p`。 |
| `comfyui.video.fps` | `24` | 输出帧率。 |
| `comfyui.video.defaultDurationSec` | `5` | 请求未给时长时使用的时长。 |
| `comfyui.video.maxDurationSec` | `10` | 允许的最长请求时长。 |
| `comfyui.video.negativePrompt` | 质量与文字类词 | 请求未给负向提示时使用的内容。 |
| `comfyui.image.model` | `z-image-turbo` | 暴露给调用方的图像模型 id。 |
| `comfyui.image.workflowPath` | 空 | API 格式工作流文件；空则使用随包的 Z-Image 图。 |
| `comfyui.image.checkpoint` | `z_image_turbo_bf16.safetensors` | `models/diffusion_models` 下的 UNET 文件名。 |
| `comfyui.image.textEncoder` | `qwen_3_4b.safetensors` | `models/text_encoders` 下的文本编码器。 |
| `comfyui.image.vae` | `ae.safetensors` | `models/vae` 下的 VAE。 |
| `comfyui.image.size` | `1024` | 生成图像的长边。 |
| `minimax.enabled` | `false` | 挂载 MiniMax 云端视频 provider。 |
| `minimax.apiKey` | 空 | 供程序化配置使用的直接 Bearer 密钥。 |
| `minimax.apiKeyEnv` | 空 | 每次请求都通过 `ctx.credentials` 解析的凭据引用；随包预设使用 `MINIMAX_API_KEY`。 |
| `minimax.baseUrl` | `https://api.minimax.cn` | MiniMax API 地址。 |
| `minimax.pollMs` | `10000` | 同一任务两次状态轮询之间的最短间隔。 |
| `minimax.timeoutMs` | `3600000` | 从提交开始计算的失败期限。 |
| `minimax.model` | `MiniMax-H3` | 暴露并提交的视频模型 id。 |
| `minimax.resolution` | `768P` | `768P` 或 `2K`。 |
| `minimax.defaultDurationSec` | `5` | 请求未给时长时使用的时长。 |
| `minimax.maxDurationSec` | `15` | 允许的最长请求时长。 |
| `minimax.aspectRatio` | `9:16` | 文生视频未指定比例时使用的画幅。 |
| `minimax.speech.enabled` | `false` | 注册 MiniMax 语音 provider。 |
| `minimax.speech.model` | `speech-2.8-turbo` | 语音模型 id；`speech-2.8-hd` 价格更高、音质更好。 |
| `minimax.speech.voiceId` | `Chinese (Mandarin)_News_Anchor` | 默认系统音色；单次请求可覆盖。 |
| `minimax.speech.speed` | `1` | 语速，范围 `[0.5, 2]`。 |
| `minimax.speech.vol` | `1` | 音量，范围 `(0, 10]`。 |
| `minimax.speech.pitch` | `0` | 音调偏移，范围 `[-12, 12]`。 |
| `minimax.speech.emotion` | 空 | 固定情绪标签；留空由模型按文本推断。 |

一次完整镜头循环：

```text
video_project init { title: "One Shot", budget_cny: 50 }
media generate { kind: "video", prompt: "a door opens", duration_sec: 4, output_path: "shots/s01.mp4" }
video_project upsert_shot { shot: { id: "s01", index: 1, prompt: "a door opens", duration_sec: 4, status: "ready", clip_path: "shots/s01.mp4" } }
video_assemble { edl: { version: 1, canvas: { width: 320, height: 568, fps: 30 }, clips: [{ kind: "video", source: "shots/s01.mp4", outSec: 1 }], output: "out/ep01.mp4" } }
video_deliver { files: [{ path: "out/ep01.mp4", format: "video" }] }
```

<a id="understand-the-implementation"></a>
## 实现说明

媒体运行时是注册为 `ctx.media` 的 Cordis 服务。provider 通过 `register()` 注册；返回的 disposer 在 fiber 卸载时移除它。选择时先读取请求 capability 的默认模型，再只接受 `models()` 中声明了该 id 与 capability 的 provider。运行时负责任务保留与有界等待，provider 负责传输、取消与计费。合成 provider 在提交时结算；ComfyUI provider 返回 `submitted`，再通过 `poll` 结算。

ComfyUI provider 用提示词、种子、画布、帧数与模型文件名填充工作流中的 `{{name}}` 占位符。整串占位符保留 JSON 类型，因此 `width`、`length`、`seed` 以整数送达。`first_frame_path` 参考会经 `/upload/image` 上传，新增 `LoadImage` 节点，并把输出接到 Wan latent 节点的 `start_image`。`submit` 向 `/prompt` 提交，`poll` 读取 `/history/<id>`，必要时回落到 `/queue` 判断 running 或 queued；完成条目经 `/view` 下载为产物字节。`cancel` 删除排队任务并中断运行中任务。提交超过 `timeoutMs` 的任务以 `MEDIA_TASK_TIMEOUT` 失败。

随包 Wan 工作流把无分类器引导固定为 1。在 Apple MPS 上，CFG>1 的批量分支会让解码后的颜色失真（构图仍在）；CFG 1 保持画面干净，同时使负向提示失效。CUDA 部署可通过 `comfyui.video.workflowPath` 挂载自己的 CFG 5 工作流。

MiniMax provider 发送 `content` 数组：一个 text 项，随后零个或多个 `image_url` 项。首帧或尾帧参考会把 `ratio` 设为 `adaptive`；纯文本请求使用配置的画幅。`submit` 返回 `submitted`，运行时任务 id 带远端 `task_id` 前缀；`poll` 读取查询接口并按 `pollMs` 节流；成功任务先下载 `content.url`，再交给运行时写入。API 没有负向提示字段，因此负向提示会以 `Avoid:` 句式追加到正向提示后。provider 限制图片 30 MB、参考图 9 张、提示词 7000 字符，单次请求体（含 base64 图片）为 64 MiB。

MiniMax 语音 provider 以 `stream: false` 提交 `text`，并在同一次调用内结算。它把 `data.audio` 从 hex 解码，读取 `extra_info.audio_length` 作为毫秒时长、`extra_info.usage_characters` 作为计费字符数，并按公布的每万字符价格计算成本。一个汉字按两个计费字符计算；`billingCharsOf` 对预估应用同一规则。`base_resp` 中的业务错误会映射为 provider 不可用、预算超限或任务失败码；非法 hex 会在字节写入工作区之前以无效产物失败。

带 `subtitles: true` 的语音请求会以 `subtitle_type: word` 打开 `subtitle_enable`，下载签名后的 `data.subtitle_file`，并把逐字时间戳分组为字幕行：句末标点结束一行，逗号在整行达到 12 个字符后结束一行，整行达到 24 个字符时在当前词处分行。`media` 工具把这些行格式化为 SubRip，写在音频旁边，因此 `voice/s01-01.mp3` 会得到 `voice/s01-01.srt`。时间戳文件缺失、不可读、超大或格式错误时，任务以 `MEDIA_ARTIFACT_INVALID` 失败，不会在不带字幕的情况下结算音频。

项目文档使用严格 schema（`schemaVersion: 1`），包含标题、画幅、目标时长、预算、镜头与成片。`video_project` 读取文档、应用一次修改、校验完整结果，再通过 `ctx.fs.writeText` 原子写入。

EDL 是可复现的渲染契约。`buildFfmpegArgs` 生成一张滤镜图：每个视觉片段裁切、等比补边到画布、重采样到画布帧率并拼接；可选音频片段裁切、增益并混音；字幕按安全区样式烧录；输出 H.264/AAC 并带 `+faststart`。汇编器先通过 `ctx.fs` 发布空输出占位文件，让父目录在同一写入策略下存在。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到四个工具。`media` 带一个 action 判别字段与共享的 kind/model/prompt/output 词汇；`video_project` 带项目 action 与镜头/成片对象；`video_assemble` 接受完整 EDL 对象；`video_deliver` 接受带格式标记的文件与项目路径。准确的描述与参数见生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-video-mode)。

#### Token 影响

每次请求有四个固定工具定义，外加模型实际调用产生的结果文本。项目摘要紧凑；`read` 返回完整 JSON，面向恢复而不是日常回合。

#### KV Cache 影响

在工具集合与描述不变时前缀稳定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **云端 provider 只服务视频** —— MiniMax-H3 返回 MP4 片段；关键帧仍来自 ComfyUI 或其他图像 provider。`MiniMax-H3-Highspeed`、`MiniMax-H3-Lite` 与 `MiniMax-H3-Max` 暂不可选，provider 只接受 `MiniMax-H3`。
- **MiniMax 按生成秒数计费** —— 5 秒 768P 片段为 2.50 元，5 秒 2K 片段为 4.00 元，尚未计入图片超额。估算对请求时长是精确的；失败任务不会在任务记录中退款。
- **ComfyUI 工作流接收提示词与一张首帧** —— `media generate` 传 `first_frame_path` 时上传该图并从它开始生成；不传时随包 Wan 图从噪声开始。首尾帧条件、风格参考与角色参考需要部署自有工作流。
- **字幕换行由标点决定** —— 语音 provider 按句末标点、逗号与 24 字符预算对词级时间戳分组，长句会在固定宽度处分行，而非编辑器指定的位置。需要在别处分行时直接调整 SRT。
- **随包 Wan 工作流忽略负向提示** —— 它使用 CFG 1，因为在 Apple MPS 上 CFG>1 的批量分支会让颜色失真。硬件与运行时能正确解码 CFG 5 时，可用自定义工作流恢复负向分支。
- **每个本地片段都从关键帧开始** —— 通过 `first_frame_path` 的首帧片段在 MPS 上渲染正常；纯提示词起始仍属实验性，颜色与构图可能漂移。视频模式 persona 与 `video-generate` 技能要求先出关键帧。
- **本地生成时间随分辨率与时长增长** —— Apple 芯片笔记本 480p 每条片段需数分钟，720p 更久；`comfyui.timeoutMs` 限制等待，`comfyui.video.resolution` 用于在质量与周转间取舍。
- **每种能力一个工作流** —— `comfyui.video.workflowPath` 整体替换随包图；两个视频后端需要在不同 id 下挂两行 provider。
- **没有持久任务存储** —— 任务记录在内存中。Provider 任务只在进程存活期间可读；重启会丢失本地记录。下一切片加入 storage-domain 日志与 `ctx.jobs` 集成。
- **没有转写、MV 与切片流水线** —— 第一切片覆盖生成式图像/视频/语音与 ffmpeg 合成。词级转写、节拍网格、源视频导入与 9:16 重构已规划。
- **没有 Web 工作台与视频预览** —— 模式可通过对话与 headless 工具调用使用。`conversation.view` 工作台、`/api/file` Range 支持与侧栏视频渲染器属于下一个客户端切片。
- **Provider 必须先下载 URL 再结算** —— 产物写入路径只接受字节。MiniMax 与 ComfyUI 会自行下载签名输出 URL；新增 provider 必须遵循同一约定。
- **合成 MP4 只有一秒** —— 使用它的更长 EDL 会停最后一帧或提前结束；合成 provider 用于打通链路，不用于时长测试。
- **ffmpeg 是 Host 前置条件** —— 可执行文件无法解析时，汇编器以 `MEDIA_FFMPEG_MISSING` 失败。烧录中文字幕需要 libass 与 CJK 字体。
- **预算门读取已记录的镜头成本** —— `media generate` 用估算值与 `project.budgetCny` 减去 `video_project` 已记录的选中尝试成本比较；模型忘记回写成本会让预算门少算。由媒体运行时直接追加的持久账本属于后续工作。
- **项目写入是后写覆盖** —— 本切片由一个 agent 拥有项目；不协调并发写入者。
- **ffmpeg 运行在 Host 执行世界** —— 汇编器通过 `ctx.fs` 解析输出，但在其旁边运行二进制；远程文件系统 provider 需要匹配的 subprocess provider。
- **没有新的 Session 事件** —— 项目文件是事实源，工具调用与结果是审计面。如果文件不足，客户端投影随工作台一起加入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本包在第一切片中有意保持为单个实验单元。等真实 provider 集合与 Web 工作台稳定后，provider 能力缝、项目文档与 EDL 将拆分到独立的 `media/` 与 `video/` 包。保持合成 provider 的确定性：测试与 keyless 快照依赖固定价格与固定字节。

`tests/minimax-speech.e2e.ts` 发起真实 T2A 请求，每次运行花费几分钱；缺少 `MINIMAX_API_KEY` 时自动跳过。运行命令：`pnpm run test:e2e packages/experimental/video-mode/tests/minimax-speech.e2e.ts`。

</details>
