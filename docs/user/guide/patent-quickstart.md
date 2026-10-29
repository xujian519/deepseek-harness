# Patent quick start

English | [中文](patent-quickstart.zh.md)

This guide takes a first patent task from a source checkout to a completed analysis, starting with the [Web UI](../../../README.md#run).

## Before you start

- Node.js >= 24.9 and pnpm 11.28.5 for the source build.
- A DeepSeek API key.
- The case directory on this machine, with disclosure documents and any reference material.

## Start the Web UI

Run from the repository root:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

Fork capabilities are not part of the published upstream package, so this source build is required.

## Configure the model and workspace

1. Open **Settings → Models**, enter the DeepSeek API key, and save it.
2. Choose the case directory as the workspace.

## Select the patent preset

Create a task and open the agent-preset picker. The patent preset is published as **专利模式** (Patent mode). The preset is fixed once the task starts, so choose it before sending the first message.

## Run a first task

Send a scoped request:

> Read the disclosure document in this workspace and list the technical problem, the inventive concept, the key technical features, and the technical effects.

The agent restates the scope and each key decision for confirmation before drafting, and it verifies statute citations before quoting them.

## What to expect

- Outputs are drafting assistance, not formal legal advice.
- Search reports name the data source, search expression, date, and coverage.
- Every factual assertion carries a source; assertions without a source are withdrawn.

## Continue

- [Use the Web UI](index.md)
- [Configure models](providers.md)
- [Architecture overview](../../architecture.md)
