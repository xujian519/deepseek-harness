---
description: "Experimental video production mode: a media provider seam, a durable project document, a reproducible EDL rendered by ffmpeg, four model-facing tools, a deterministic synthetic provider, a local ComfyUI provider for Wan 2.2 video and Z-Image images, and a cloud MiniMax-H3 video provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-video-mode

English | [中文](README.zh.md)

## Summary

This package is the first host slice of the video mode. It provides `ctx.media`, a provider registry for image, video, and speech generation, a durable project document under `video/<id>/project.json`, a validated edit decision list (EDL) rendered by ffmpeg, and four model-facing tools: `media`, `video_project`, `video_assemble`, and `video_deliver`. Three providers ship: a deterministic synthetic provider for credential-free runs, a local ComfyUI provider that renders Wan 2.2 TI2V-5B video and Z-Image Turbo images on the operator's machine, and a cloud MiniMax-H3 provider that submits video tasks to the MiniMax API.

## Table of Contents

- [What it mounts](#what-it-mounts)
- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-mounts"></a>
## What it mounts

- **`ctx.media`** — a provider registry and one execution path per capability. It selects a provider by configured default model or by an explicit `model`, resolves the model at execution time, rejects unavailable and ambiguous selections with stable `MediaFailure` codes, retains a bounded number of task records, and waits up to `waitMs` for settlement.
- **The `media` tool** — one action-discriminated tool (`models`, `estimate`, `generate`, `status`, `cancel`) that lists models and prices, previews cost, submits a generation, writes the artifact through `ctx.fs`, and reads or cancels a task.
- **The `video_project` tool** — creates, reads, and mutates the project document. Every mutation validates the complete document before writing it; the project file is the single source of truth for shots, selected clips, renders, and the budget.
- **The `video_assemble` tool** — validates an EDL, renders it through ffmpeg with a normalized filter graph (canvas, fps, aspect-fit padding, concat, audio mix, subtitle burn-in, faststart), and returns measured duration, resolution, and audio presence.
- **The `video_deliver` tool** — declares final files and returns machine checks. It refuses a missing video, an incomplete shot list, a video without a readable stream, and a reported cost above the budget; it warns on a duration mismatch and a missing audio stream.
- **The synthetic provider** — deterministic PNG, WAV, and MP4 fixtures with fixed prices. It is enabled by `fakeProvider: true`.
- **The ComfyUI provider** — submits an API-format workflow to a local ComfyUI server, polls its history, downloads the produced file, and settles the task with inline bytes. The bundled graphs render Wan 2.2 TI2V-5B video and Z-Image Turbo images; `comfyui.video.workflowPath` and `comfyui.image.workflowPath` accept a deployment's own workflow. Local compute has no per-generation charge, so every estimate reports zero CNY.
- **The MiniMax provider** — submits one MiniMax-H3 video task to `https://api.minimax.cn/v2/video_generation`, polls `/v2/query/video_generation/<id>`, downloads the settled MP4, and settles with inline bytes. Text, first-frame, last-frame, and reference-image inputs are supported; local image files travel as data URIs. Estimates use the published CNY rates: 0.50 per generated second at 768P and 0.80 at 2K.

<a id="use-this-package"></a>
## Use this package

Mount the service in a composition that also provides `ctx.tools`, `ctx.fs`, and `ctx.subprocess`:

```yaml
- id: video-mode
  name: '@deepseek-ai/dsh-experimental-video-mode'
  config:
    fakeProvider: true
    waitMs: 30000
    ffmpegPath: ffmpeg
    ffprobePath: ffprobe
```

The video preset renders keyframes locally and video in the cloud:

```yaml
- id: video-mode
  name: '@deepseek-ai/dsh-experimental-video-mode'
  config:
    fakeProvider: false
    imageModel: z-image-turbo
    videoModel: MiniMax-H3
    comfyui:
      enabled: true
      baseUrl: http://127.0.0.1:8188
      image:
        size: 1024
    minimax:
      enabled: true
      apiKey: !!js process.env.MINIMAX_API_KEY ?? ''
      resolution: 768P
      aspectRatio: 9:16
```

MiniMax prerequisites: a MiniMax API key in the launch environment or the invoking directory's `.env` as `MINIMAX_API_KEY`, and H3 video access on the account or M Plan. A missing key fails at load with `video mode: minimax.apiKey must not be empty`; an unauthorized or unpaid key fails the first submission with the provider's message. MiniMax-H3 accepts 4–15 second clips at 768P or 2K; a first or last frame forces `ratio: adaptive`.

ComfyUI prerequisites for keyframes: ComfyUI 0.38 or newer reachable at `comfyui.baseUrl`, with Z-Image Turbo, the `qwen_3_4b` text encoder, and `ae.safetensors` under `models/`. The Wan 2.2 files remain optional for deployments that select `wan2.2-ti2v-5b` explicitly. Any missing file fails at the first submission with ComfyUI's node error, and a wrong file name in the config fails the same way.

| Field | Default | Meaning |
|---|---|---|
| `fakeProvider` | `true` | Mount the synthetic provider. Set false when a real provider is mounted. |
| `imageModel` | `synthetic/image` | Default image model id. |
| `videoModel` | `synthetic/video` | Default video model id. |
| `speechModel` | `synthetic/speech` | Default speech model id. |
| `waitMs` | `30000` | How long `media generate` waits before returning a running task id. |
| `pollMs` | `250` | Poll interval while waiting. |
| `maxArtifactBytes` | `536870912` | Largest accepted artifact size. |
| `maxTasks` | `64` | Retained task records. |
| `ffmpegPath` | `ffmpeg` | ffmpeg executable name or path. |
| `ffprobePath` | `ffprobe` | ffprobe executable name or path. |
| `syntheticLatencyMs` | `0` | Synthetic provider delay before settlement. |
| `subtitleFont` | empty | Font family for burned subtitles; empty uses ffmpeg's default. |
| `approvalThresholdCny` | `10` | A generation whose estimate exceeds this requires `confirm_cost` and a user confirmation. |
| `comfyui.enabled` | `false` | Register the local ComfyUI provider. |
| `comfyui.baseUrl` | `http://127.0.0.1:8188` | ComfyUI HTTP origin. |
| `comfyui.pollMs` | `2000` | Minimum gap between two history polls for one task. |
| `comfyui.timeoutMs` | `3600000` | Failure deadline measured from submission. |
| `comfyui.outputPrefix` | `dsh` | Output subdirectory the server writes into. |
| `comfyui.video.model` | `wan2.2-ti2v-5b` | Video model id reported to consumers. |
| `comfyui.video.workflowPath` | empty | API-format workflow file; empty uses the bundled Wan 2.2 graph. |
| `comfyui.video.checkpoint` | `wan2.2_ti2v_5B_fp16.safetensors` | UNET file under `models/diffusion_models`. |
| `comfyui.video.textEncoder` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | Text encoder under `models/text_encoders`. |
| `comfyui.video.vae` | `wan2.2_vae.safetensors` | VAE under `models/vae`. |
| `comfyui.video.resolution` | `480p` | Canvas short side as a `<n>p` label. |
| `comfyui.video.fps` | `24` | Output frame rate. |
| `comfyui.video.defaultDurationSec` | `5` | Duration used when the request omits one. |
| `comfyui.video.maxDurationSec` | `10` | Longest accepted request duration. |
| `comfyui.video.negativePrompt` | quality and text terms | Negative prompt used when the request omits one. |
| `comfyui.image.model` | `z-image-turbo` | Image model id reported to consumers. |
| `comfyui.image.workflowPath` | empty | API-format workflow file; empty uses the bundled Z-Image graph. |
| `comfyui.image.checkpoint` | `z_image_turbo_bf16.safetensors` | UNET file under `models/diffusion_models`. |
| `comfyui.image.textEncoder` | `qwen_3_4b.safetensors` | Text encoder under `models/text_encoders`. |
| `comfyui.image.vae` | `ae.safetensors` | VAE under `models/vae`. |
| `comfyui.image.size` | `1024` | Long side of a generated image. |
| `minimax.enabled` | `false` | Register the MiniMax cloud video provider. |
| `minimax.apiKey` | empty | Bearer API key; set from `$MINIMAX_API_KEY`. Empty fails at load. |
| `minimax.baseUrl` | `https://api.minimax.cn` | MiniMax API origin. |
| `minimax.pollMs` | `10000` | Minimum gap between two status polls for one task. |
| `minimax.timeoutMs` | `3600000` | Failure deadline measured from submission. |
| `minimax.model` | `MiniMax-H3` | Video model id reported and submitted. |
| `minimax.resolution` | `768P` | `768P` or `2K`. |
| `minimax.defaultDurationSec` | `5` | Duration used when the request omits one. |
| `minimax.maxDurationSec` | `15` | Longest accepted request duration. |
| `minimax.aspectRatio` | `9:16` | Text-to-video ratio when the request omits one. |

A complete shot cycle:

```text
video_project init { title: "One Shot", budget_cny: 50 }
media generate { kind: "video", prompt: "a door opens", duration_sec: 4, output_path: "shots/s01.mp4" }
video_project upsert_shot { shot: { id: "s01", index: 1, prompt: "a door opens", duration_sec: 4, status: "ready", clip_path: "shots/s01.mp4" } }
video_assemble { edl: { version: 1, canvas: { width: 320, height: 568, fps: 30 }, clips: [{ kind: "video", source: "shots/s01.mp4", outSec: 1 }], output: "out/ep01.mp4" } }
video_deliver { files: [{ path: "out/ep01.mp4", format: "video" }] }
```

<a id="understand-the-implementation"></a>
## Understand the implementation

The media runtime is a Cordis service registered as `ctx.media`. Providers register with `register()`; the returned disposer removes the provider on fiber unload. Selection reads the configured default model for the requested kind, then accepts only a provider whose `models()` advertises that id and capability. The runtime owns task retention and the bounded wait, while each provider owns transport, cancellation, and cost accounting. The synthetic provider settles during submission; the ComfyUI provider returns `submitted` and settles through `poll`.

The ComfyUI provider fills the workflow's `{{name}}` placeholders with the prompt, seed, canvas, frame count, and model file names. A placeholder that occupies a whole string keeps its JSON type, so `width`, `length`, and `seed` arrive as integers. A `first_frame_path` reference is uploaded to `/upload/image`, a `LoadImage` node is added, and its output is wired to the Wan latent node's `start_image`. `submit` posts to `/prompt`, `poll` reads `/history/<id>` and falls back to `/queue` for the running or queued state, and a completed entry downloads its file through `/view` into artifact bytes. `cancel` deletes a queued prompt and interrupts a running one. A submission older than `timeoutMs` fails with `MEDIA_TASK_TIMEOUT`.

The bundled Wan graph runs classifier-free guidance at 1. On Apple MPS the CFG>1 batch corrupts the decoded colors while the composition survives; CFG 1 keeps the frame clean and makes the negative prompt inert. A CUDA deployment can mount its own workflow with CFG 5 through `comfyui.video.workflowPath`.

The MiniMax provider sends a `content` array: one text item, then zero or more `image_url` items. A first-frame or last-frame reference sets `ratio: adaptive`; a text-only request uses the configured ratio. `submit` returns `submitted` with a runtime id prefixed by the remote `task_id`, `poll` reads the query endpoint and throttles to `pollMs`, and a succeeded task downloads `content.url` before the runtime writes it. A negative prompt has no API field, so it is appended to the positive prompt as an `Avoid:` sentence. The provider caps image files at 30 MB, references at nine, and prompts at 7000 characters.

The project document has a strict schema (`schemaVersion: 1`) with title, aspect, target duration, budget, shots, and renders. `video_project` reads the document, applies one mutation, validates the whole result, and writes it atomically through `ctx.fs.writeText`.

The EDL is the reproducible render contract. `buildFfmpegArgs` emits one filter graph: every visual clip is trimmed, aspect-fit padded to the canvas, resampled to the canvas fps, and concatenated; optional audio clips are trimmed, gained, and mixed; subtitles are burned with a style that keeps text inside a safe area; the output is H.264/AAC with `+faststart`. The assembler publishes an empty output placeholder through `ctx.fs` so the parent directory exists under the same write policy.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees four tools. `media` carries one action discriminator and the shared kind/model/prompt/output vocabulary; `video_project` carries the project actions and the shot/render objects; `video_assemble` accepts the complete EDL object; `video_deliver` accepts files with a format tag and the project path. The exact descriptions and parameters are in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-video-mode).

#### Token effect

Four fixed tool definitions on every request, plus the result text of the calls the model makes. The project summary is compact; `read` returns the complete JSON and is intended for recovery, not routine turns.

#### KV Cache effect

Prefix-stable while the registered tool set and descriptions are unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


- **The cloud provider serves video only** — MiniMax-H3 returns MP4 clips; keyframes still come from ComfyUI or another image provider. `MiniMax-H3-Highspeed`, `MiniMax-H3-Lite`, and `MiniMax-H3-Max` are not selectable because the provider validates the configured model id.
- **MiniMax bills per generated second** — a 5-second 768P clip costs 2.50 CNY and a 5-second 2K clip costs 4.00 CNY before any image overage. The estimate is exact for the requested duration; the provider does not refund a failed task in the task record.
- **The ComfyUI workflows take a prompt and one first frame** — `media generate` with `first_frame_path` uploads that image and starts the clip from it; without one the bundled Wan graph starts from noise. First-last-frame conditioning, style references, and character references need a deployment workflow.
- **No speech provider** — ComfyUI serves image and video here, so the video preset has no text-to-speech. A voiceover needs an external speech provider or recorded audio.
- **The bundled Wan graph ignores the negative prompt** — it runs CFG 1 because the CFG>1 batch corrupts colors on Apple MPS. A workflow with CFG 5 restores the negative branch on hardware and runtimes that decode it correctly.
- **Start every local clip from a keyframe** — a keyframe-first clip through `first_frame_path` renders cleanly on MPS; a prompt-only start is experimental and can drift in color and composition. The video-mode persona and `video-generate` skill require the keyframe step.
- **Local generation time grows with resolution and duration** — an Apple-silicon laptop at 480p takes minutes per clip and longer at 720p; `comfyui.timeoutMs` bounds the wait, and `comfyui.video.resolution` trades quality for turnaround.
- **One workflow per kind** — `comfyui.video.workflowPath` replaces the bundled graph wholesale; two video backends need two provider rows under separate ids.
- **No durable task store** — task records are in memory. A provider task survives only while the process does; a restart loses the local record. The next slice adds a storage-domain journal and `ctx.jobs` integration.
- **No transcript, MV, or clip-cutting pipeline** — the first slice covers generated image/video/speech and ffmpeg assembly. Word-level transcription, beat grids, source-video ingestion, and 9:16 reframing are planned.
- **No Web studio or video preview** — the mode is usable through chat and headless tool calls. The `conversation.view` studio, `/api/file` Range support, and the sidebar video renderer are the next client slice.
- **Provider URLs are not downloaded** — an artifact must arrive as bytes. A provider that returns a signed URL must download it before settling.
- **The synthetic MP4 is one second** — a longer EDL using it will hold the last frame or end early; use the synthetic provider for wiring, not for timing tests.
- **ffmpeg is a host prerequisite** — the assembler fails with `MEDIA_FFMPEG_MISSING` when the executable cannot be resolved. `libass` and a CJK font are required for burned Chinese subtitles.
- **The budget gate reads recorded shot costs** — `media generate` compares its estimate with `project.budgetCny` minus the selected attempts already recorded by `video_project`; a model that forgets to write a cost back leaves the gate under-counting. A durable ledger that the media runtime appends to is deferred.
- **Project writes are last-writer-wins** — one agent owns a project in this slice; concurrent writers are not coordinated.
- **ffmpeg runs in the Host execution world** — the assembler resolves the output through `ctx.fs` but runs the binary beside it; a remote filesystem provider needs a matching subprocess provider.
- **No session event** — the project file is the source of truth; tool calls and results are the audit trail. A client projection will be added with the studio if the file proves insufficient.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package is intentionally one experimental unit for the first slice. The provider seam, project document, and EDL are designed for promotion into separate `media/` and `video/` packages once the real provider set and the Web studio stabilize. Keep the synthetic provider deterministic: tests and keyless snapshots depend on fixed prices and fixed bytes.

</details>
