/**
 * Shared contract helpers for the desktop unsigned-release workflow specs.
 *
 * The macOS and Windows lanes are configured the same way except for the runner,
 * the packaging step and the publish naming, so the loader, the step lookup and the
 * assertions that both lanes must satisfy live here rather than being cloned into
 * each spec.
 *
 * @module dsh-scripts/desktop-unsigned-release-workflow
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect } from 'vitest'

const root = resolve(import.meta.dirname, '..')

/** One step of an unsigned-release job, as the workflow YAML declares it. */
export interface ReleaseStep {
  name?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

/** One unsigned-release job, keyed by the platform target it runs. */
export interface ReleaseJob {
  'runs-on': string
  'timeout-minutes': number
  defaults?: { run: { shell: string } }
  steps: ReleaseStep[]
}

/** The subset of a desktop unsigned-release workflow both lanes declare. */
export interface ReleaseWorkflow {
  on: { workflow_dispatch: { inputs: Record<string, { type?: string; required?: boolean; default?: unknown }> } }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<string, ReleaseJob>
}

/**
 * Load one desktop unsigned-release workflow as a typed document.
 * @param fileName - YAML file name under `.github/workflows`.
 * @returns the parsed workflow.
 */
export function loadReleaseWorkflow(fileName: string): ReleaseWorkflow {
  return yaml.load(readFileSync(resolve(root, '.github/workflows', fileName), 'utf8')) as ReleaseWorkflow
}

/**
 * Find the step that declares an exact name.
 * @param job - the job whose steps to search.
 * @param name - the step name to match.
 * @returns the matching step.
 * @throws when no step declares the name.
 */
export function stepOf(job: ReleaseJob, name: string): ReleaseStep {
  const step = job.steps.find(candidate => candidate.name === name)
  if (step === undefined) throw new Error(`no step named ${name}`)
  return step
}

/**
 * Assert the dispatch, permission, concurrency, checkout and publish credential
 * contract that every unsigned-release lane shares.
 * @param workflow - the parsed lane workflow.
 * @param job - the platform job under test.
 */
export function expectSharedDispatchContract(workflow: ReleaseWorkflow, job: ReleaseJob): void {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual(['draft', 'tag'])
  expect(workflow.on.workflow_dispatch.inputs.draft?.default).toBe(false)
  expect(workflow.permissions).toEqual({ contents: 'write' })
  expect(workflow.concurrency).toEqual({ group: '${{ github.workflow }}-${{ github.ref }}', 'cancel-in-progress': false })
  expect(job.steps.find(candidate => candidate.uses?.startsWith('actions/checkout@'))?.with)
    .toMatchObject({ 'persist-credentials': false })
  expect(stepOf(job, 'Publish the release').env).toMatchObject({
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    REQUESTED_TAG: '${{ inputs.tag }}',
    DRAFT: '${{ inputs.draft }}',
  })
}
