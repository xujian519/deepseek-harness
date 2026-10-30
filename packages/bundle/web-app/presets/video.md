# Video agent preset

English | [中文](video.zh.md)

The `video` agent preset composes a video-production agent on the DeepSeek Harness. It builds on the `standard` preset, replaces the persona and plan-mode section with video-production ones, adds six production skills, and mounts the experimental video mode's four tools. The mode produces a project document, per-shot media, an EDL, and an assembled MP4 with an explicit delivery check.

## What it mounts

Beyond the standard coding rows a video workflow needs (shell, filesystem, jobs, schedules, skills, goals, plan mode, compaction, delegation, ask-user, todo, and web), the preset contributes:

- Six production skills in `skills/video/`: `video-brief` (specification), `video-storyboard` (shots and assets), `video-generate` (keyframe-first media), `video-voice` (voice, BGM, subtitles), `video-assemble` (EDL and ffmpeg), and `video-deliver` (machine checks and registration).
- One `video-mode` row from `@deepseek-ai/dsh-experimental-video-mode`. It provides `ctx.media`, the cloud MiniMax-H3 video provider, the local ComfyUI provider (Z-Image Turbo keyframes; Wan 2.2 remains selectable as `wan2.2-ti2v-5b`), and four model-facing tools: `media`, `video_project`, `video_assemble`, and `video_deliver`.
- A video-production persona (specification first, assets before shots, keyframes before clips, estimate before spending, machine checks before delivery) and a video-flavored plan-mode section: platform, duration, aspect, budget, script, storyboard, asset plan, and delivery list are "plans" — no paid generation or final render before approval.

Against the row set `standard` carries, this preset deliberately omits four rows — `tool-plugin-market`, `present`, `tool-plugin-manager`, and `openviking`. `tool-plugin-market` is read-only catalog browsing; installing a plugin is a deployment action. `present` declares an arbitrary accessible file as a deliverable; this mode declares its deliverables through `video_deliver`, which carries the machine checks the studio will render. `tool-plugin-manager` writes profile configuration and the host patch ships it disabled. `openviking` is opt-in external memory over an HTTP service this composition does not run. `scripts/preset-mode-baseline.json` records each reason.

## Prerequisites

- `ffmpeg` and `ffprobe` on the host. The assembler fails with `MEDIA_FFMPEG_MISSING` when either cannot be resolved. Burned Chinese subtitles need `libass` and a CJK font.
- A MiniMax API key with H3 video access, available as `$MINIMAX_API_KEY` in the launch environment or the invoking directory's `.env`. A missing key fails preset load; an unauthorized or unpaid key fails the first video submission with the provider's message.
- A local ComfyUI server (0.38 or newer) at `http://127.0.0.1:8188`, with Z-Image Turbo under `models/`. Keyframes come from this row. The Wan 2.2 TI2V-5B files are optional and used only when a caller selects `wan2.2-ti2v-5b` explicitly.
- The preset runs `fakeProvider: false`, so every artifact comes from MiniMax or ComfyUI. For a credential-free demo, set `fakeProvider: true` and select a `synthetic/*` model; the synthetic provider produces one-second clips and fixed prices.

## Model Experience

The model sees the video-production persona, the video plan-mode section, the six preset skills, and the four video tools alongside the standard tools. The persona states the budget (50 CNY default), the 10 CNY single-generation confirmation threshold, the keyframe-first discipline, the machine-check rule, and the honest degradation rules (no vision model means "not reviewed"; no ffmpeg means "cannot assemble").

The tools carry the production vocabulary: `media` selects a model and writes an artifact, `video_project` owns the project document, `video_assemble` renders an EDL, and `video_deliver` checks the declared files and refuses incomplete or over-budget work.

## Known Limitations and Deferred Work

- **No Web studio** — the mode is usable through chat. The `conversation.view` production board, video preview, and `/api/file` Range support are the next client slice.
- **Cloud video is the default** — MiniMax-H3 serves video and bills per generated second (0.50 CNY at 768P, 0.80 at 2K). A 5-second 768P clip estimates at 2.50 CNY; clips above the 10 CNY confirmation threshold need user approval.
- **The bundled Wan graph runs CFG 1** — the CFG>1 batch corrupts colors on Apple MPS, so the negative prompt has no effect. A deployment on a compatible runtime mounts its own workflow with CFG 5.
- **Local video starts from a keyframe** — when a caller selects `wan2.2-ti2v-5b`, `video-generate` passes the shot keyframe as `first_frame_path`; a prompt-only local start can drift in color and composition on MPS. MiniMax-H3 also accepts a keyframe, and the skill still sends one for cross-shot consistency.
- **No speech provider** — ComfyUI serves images and MiniMax serves video here. A voiceover needs recorded audio or an external speech provider, and `video-voice` must say so instead of inventing a track.
- **No transcript, MV, or clip-cutting pipeline** — the preset's persona names those workflows, but word-level transcription, beat grids, source-video ingestion, and 9:16 reframing are planned; the assistant must say so when asked.
- **No digital-human lip sync** — talking-head work uses a host image, B-roll, and voice-over.
- **No automatic publishing** — delivery ends at files and a manifest; publishing stays with the user.
