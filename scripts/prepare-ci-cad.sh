#!/usr/bin/env bash
set -euo pipefail

# Installs the renderers the patent-figure smoke suites drive: Inkscape for
# text-to-path and png/pdf export, FreeCAD for TechDraw projection, section
# geometry and hatching. Both suites skip themselves when their executable is
# missing, so a lane that runs them without provisioning reads green over no
# coverage; `.github/workflows/ci-fork.yml` runs this first and the lane sets
# DSH_CAD_CI_SIGNAL for `figure-cad-ci-signal.spec.ts`, which fails there if
# either install disappears.
#
# Ubuntu's FreeCAD package is 0.21, below the 1.1 API the renderer uses, so the
# AppImage is extracted rather than mounted: extraction needs no FUSE, and
# AppRun carries the bundled PYTHONHOME that the extracted `usr/bin/freecadcmd`
# otherwise lacks.
readonly FREECAD_VERSION='1.1.4'
readonly FREECAD_ASSET="FreeCAD_${FREECAD_VERSION}-Linux-x86_64-py311.AppImage"
readonly FREECAD_SHA256='f6dc6ba676e5ac96a565ebc8d657232f94c6158e85b4352141bd1a46f6b43434'
readonly FREECAD_URL="https://github.com/FreeCAD/FreeCAD/releases/download/${FREECAD_VERSION}/${FREECAD_ASSET}"

: "${RUNNER_TEMP:?prepare-ci-cad requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-cad requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-cad supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

# `fc-match` comes with fontconfig; the Inkscape smoke asserts a converted file
# keeps its geometry, which needs the same CJK face the drawing asks for.
sudo apt-get update
sudo apt-get install -y --no-install-recommends inkscape fontconfig fonts-noto-cjk

work="${RUNNER_TEMP}/dsh-cad"
mkdir -p "${work}"
appimage="${work}/${FREECAD_ASSET}"

# GitHub's release object store occasionally drops a connection mid-transfer;
# bound each attempt so the retries stay inside the job's time budget.
curl --fail --silent --show-error --location \
  --connect-timeout 15 --max-time 600 \
  --retry 5 --retry-delay 5 --retry-max-time 900 \
  --output "${appimage}" "${FREECAD_URL}"
echo "${FREECAD_SHA256}  ${appimage}" | sha256sum --check --status

chmod +x "${appimage}"
(
  cd "${work}"
  rm -rf squashfs-root
  "${appimage}" --appimage-extract >/dev/null
)

# `findFreeCadCmd` scans PATH for this name; the wrapper supplies the AppRun
# environment while keeping the argv contract of a real `freecadcmd`.
bin="${work}/bin"
mkdir -p "${bin}"
cat > "${bin}/freecadcmd" <<EOF
#!/bin/sh
exec "${work}/squashfs-root/AppRun" freecadcmd "\$@"
EOF
chmod +x "${bin}/freecadcmd"
echo "${bin}" >> "${GITHUB_PATH}"

# Fail here, where the cause is legible, rather than letting the suites turn
# back into skips in a lane that installed nothing.
"${bin}/freecadcmd" --version
inkscape --version
