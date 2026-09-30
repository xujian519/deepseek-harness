This macOS build is **unsigned**: it carries no Developer ID signature and no notarization ticket, and it configures no automatic updater.

It is published for internal installation testing. New versions are installed by downloading a new archive; the application never updates itself.

## Install

1. Download the `deepseek-harness-<version>-mac-arm64-unsigned.zip` archive and its `.sha256` file.
2. Verify the download before opening it:

```sh
shasum -a 256 -c deepseek-harness-<version>-mac-arm64-unsigned.zip.sha256
```

3. Unpack the archive and move `DeepSeek Harness.app` into `/Applications`.
4. Clear the quarantine attribute macOS adds to downloaded applications, or approve the application once in **System Settings → Privacy & Security** with **Open Anyway**:

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

The application is signed ad-hoc, so the system reports that it cannot be verified rather than that it is damaged. Opening it from the shortcut menu does not always offer this approval on current macOS versions; use the System Settings path above when it does not.

## Requirements and behaviour

- Apple Silicon only (`arm64`). An Intel archive is published separately when one is built.
- macOS quarantine applies per machine: every machine that downloads the archive repeats the approval step.
- The application shares sessions, settings, credentials, and workspaces with the `dsh` CLI under `$DSH_HOME` (`~/.dsh` by default).
- The bundled runtime is prepared on first launch, so the first start takes longer than later ones.

## Reporting problems

Include the version shown in the release title, whether the failure happened at first launch or later, and the output of `Console.app` for the process if the window never appears.
