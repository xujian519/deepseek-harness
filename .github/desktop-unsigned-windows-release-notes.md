This Windows build is **unsigned**: the installer carries no Authenticode signature and no timestamp, and it configures no automatic updater.

It is published for internal installation testing. New versions are installed by downloading and running a new installer; the application never updates itself.

## Install

1. Download the `deepseek-harness-<version>-win-x64-unsigned.exe` installer and its `.sha256` file into the same directory.
2. Verify the download before running it:

```pwsh
$file = 'deepseek-harness-<version>-win-x64-unsigned.exe'
$expected = ((Get-Content "$file.sha256") -split ' ')[0]
(Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -eq $expected
```

The command prints `True` when the installer matches its recorded hash.

3. Run the installer. It installs for the current user only and never requests elevation.
4. Windows SmartScreen reports an unrecognized publisher. Choose **More info**, then **Run anyway**.

## Requirements and behaviour

- Windows x64 only.
- The installer is not code-signed: an enterprise policy that requires signed installers blocks it entirely, and Windows repeats the SmartScreen warning for every new version.
- The application shares sessions, settings, credentials, and workspaces with the `dsh` CLI under `$DSH_HOME` (`%USERPROFILE%\.dsh` by default).
- The bundled runtime is prepared on first launch, so the first start takes longer than later ones.

## Reporting problems

Include the version shown in the release title, whether the failure happened at installation or at first launch, and the packaging journal of the run that produced the installer.
