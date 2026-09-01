# Agent Note: Gate directory-picker wire verbs on the verb, not the capability kind

Status: implemented

English | [中文](2026-09-01-directory-picker-verb-gating-regression.zh.md)

## Problem

Clicking Add-workspace in the packaged desktop app failed with:

```
directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "electron"
```

`DirectoryPickerController.pick` resolved its backend through `requireCapability('native', 'pick')`, which compared `capability.kind` against the `native` literal. The desktop composition registers `ctx.directoryPicker` from `ElectronDirectoryPicker`, whose capability kind is `electron`, so every pick was refused with `directory-picker/unavailable`.

`DirectoryPickerCapabilities` is merge-extensible: `electron` declaration-merges into the seam from `packages/desktop/directory-picker/src/index.ts` only, so the Host program that compiles the controller has no type for it and a kind comparison there can never admit it. Treating a merge-extensible union as closed is what the repo convention forbids — such a union falls through a documented default instead.

This regressed a decision already recorded in [2026-08-25](2026-08-25-desktop-surface-patch-handoff-and-picker.md). That note replaced the same `native` literal with `if (!('pick' in capability))` in the then-current `host.pickDirectory` RPC. Two days later the Remote migration wrote `DirectoryPickerController` from scratch with the literal comparison restored, and removing the apiproxy RPCs took the presence check with it. The controller's spec only covered a browse composition refusing `pick`; no case asserted that a pick-capable backend the Host program cannot name is served, so the regression landed silently.

The desktop composition itself was never at fault: `packages/bundle/desktop-app/cordis.patch.yml` correctly disables the auto row and pins the electron provider beside the native client surface.

## Decision

Each wire verb gates on the presence of the primitive it forwards to, not on a kind literal.

`requireCapability` takes only the verb, typed as that interaction's own members, and its caller names the interaction through an explicit type argument:

```ts
private requireCapability<Kind extends keyof DirectoryPickerCapabilities>(
  method: Exclude<keyof DirectoryPickerCapabilities[Kind], 'kind'> & string,
): DirectoryPickerCapabilities[Kind] {
  const capability = this.ctx.directoryPicker.capability()
  if (!(method in capability)) throw new RemoteError('directory-picker/unavailable', ...)
  return capability as DirectoryPickerCapabilities[Kind]
}
```

Typing `method` against `DirectoryPickerCapabilities[Kind]` keeps the runtime presence check from drifting from the verb it gates: a renamed primitive stops compiling rather than refusing at runtime.

The refusal message states what the backend serves instead of asserting a required kind: `the composed picker serves "browse", which does not provide directoryPicker.pick`. The `directory-picker/unavailable` code and its `{ capability }` details are unchanged, so client discrimination is unaffected.

Behavior per capability: `native` and `electron` serve `pick`; `browse` serves `list` and `createDirectory`; every other pairing is refused, as is any future kind that provides none of them.

## Alternatives considered

**Collapse `electron` into `native`.** The two capabilities carry the same verb and the same return contract, so one kind would remove the mismatch at its source. Rejected: their abort behavior genuinely differs — the native chooser terminates on abort, while Electron exposes no programmatic close and its dialog stays open until the operator acts — and the seam documents kinds as consumer-visible. Collapsing them would also weaken the merge-extensible registry the seam is built on without fixing the convention violation, which is the exact-match comparison itself.

**Keep the kind comparison and add `electron` to the Host program's union.** Rejected: the Host program does not depend on `packages/desktop/*`, and importing a desktop declaration into it to satisfy a comparison inverts the seam's direction.

**Keep `kind` as a parameter for inference.** Rejected: with the gate structural, `kind` would be read by nothing and `noUnusedParameters` rejects it. An explicit type argument names the interaction at the call site without a dead parameter.

## Consequences

The desktop Add-workspace flow opens the Electron chooser again. Any future backend merged into the seam is served by whichever verbs it provides, without an edit to the controller — the property the 2026-08-25 decision intended and this change restores.

`packages/api/workspace-controller/tests/directory-picker.host.spec.ts` now stubs an electron-shaped capability through a cast (the Host program has no type for that kind, which is the condition under test) and asserts `pick` answers it. That case is the guard the migration lacked; it fails against the kind comparison with the exact message operators saw.

The desktop app runs a built `lib` snapshot deployed into `apps/desktop/resources/<os>/backend`, so this fix reaches operators only through `pnpm run package:desktop:mac` and a reinstall, not through a source-side test run.
