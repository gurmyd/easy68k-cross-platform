<#
.SYNOPSIS
  `npm run setup:emsdk` on Windows (ARCHITECTURE.md 7.1, 7.2;
  docs\porting\toolchain.md 2-3): installs the pinned Emscripten into
  <repository>\.toolchain\emsdk.

.DESCRIPTION
  Nothing outside that folder is changed: no PATH, registry or profile
  setting ("activate" without --permanent only writes .toolchain\emsdk\.emscripten).
  Needs git. Running it again when the pinned version is already installed
  only checks it and exits. The engine build scripts find em++ in
  .toolchain\emsdk by themselves; to use emcc in a shell, dot-source
  tools\emsdk-env.ps1.

.PARAMETER Version
  Emscripten version; the default is the pinned one (also in setup-emsdk.sh,
  toolchain.md and the CI cache key). Change it only to try an update.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-emsdk.ps1
#>
[CmdletBinding()]
param(
    [string]$Version = '7.0.0'
)

$ErrorActionPreference = 'Stop'

$root        = Split-Path -Parent $PSScriptRoot
$emsdk       = Join-Path $root '.toolchain\emsdk'
$versionFile = Join-Path $emsdk 'upstream\emscripten\emscripten-version.txt'
$repoUrl     = 'https://github.com/emscripten-core/emsdk.git'

function Get-InstalledVersion {
    if (Test-Path $versionFile) { return ((Get-Content -Raw $versionFile) -replace '["\s]', '') }
    return ''
}

function Test-Emxx {
    return (Test-Path (Join-Path $emsdk 'upstream\emscripten\em++.exe')) -or
           (Test-Path (Join-Path $emsdk 'upstream\emscripten\em++.bat'))
}

# Runs a native program; throws on a non-zero exit code.
function Invoke-Native([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program $($arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

if ((Get-InstalledVersion) -eq $Version -and (Test-Emxx)) {
    Write-Host "setup-emsdk: Emscripten $Version is already installed in $emsdk"
    exit 0
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'setup-emsdk: git is required but was not found on PATH' }

New-Item -ItemType Directory -Force (Join-Path $root '.toolchain') | Out-Null
if (-not (Test-Path (Join-Path $emsdk '.git'))) {
    Write-Host "setup-emsdk: cloning $repoUrl into $emsdk"
    Invoke-Native 'git' @('clone', '--depth', '1', $repoUrl, $emsdk)
} else {
    Write-Host "setup-emsdk: updating the emsdk checkout in $emsdk"
    & git -C $emsdk pull --ff-only --depth 1
    if ($LASTEXITCODE -ne 0) { Write-Warning 'setup-emsdk: could not update emsdk; using the existing checkout' }
}

$emsdkBat = Join-Path $emsdk 'emsdk.bat'
Invoke-Native $emsdkBat @('install', $Version)
Invoke-Native $emsdkBat @('activate', $Version)

$got = Get-InstalledVersion
if ($got -ne $Version) { throw "setup-emsdk: expected Emscripten $Version, found '$got' in $versionFile" }
Write-Host "setup-emsdk: Emscripten $Version installed in $emsdk"
