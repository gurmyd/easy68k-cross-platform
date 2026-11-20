<#
.SYNOPSIS
  Builds the WebAssembly smoke-test build of the same ASM68K v5.15.4 sources
  that the native oracle is built from, with Emscripten (em++).

.DESCRIPTION
  Input : <project>\build\oracle\asm-cli-5.15.4\src\*.CPP  (created by
          tools\build-asm-oracle.ps1; verified here to be byte-identical to
          <project>\reference\easy68k-asm-cli\ASM68Kv5.15.4). The MSVC shim in
          src\msvc-compat is NOT used: the sources compile unmodified.
  Output: <project>\build\oracle\asm-cli-5.15.4-wasm\asy68k.mjs + asy68k.wasm
          (ES6 module, MODULARIZE, Node only). Run it through
          <project>\build\oracle\asm-cli-5.15.4-wasm\run-asy68k.mjs.

  The flags that matter (see docs\porting\toolchain.md for why):
    -ftrivial-auto-var-init=zero   REQUIRED at any -O level above -O0. Without
                                   it clang exploits an uninitialised return
                                   value in SYMBOL.CPP lookup() and the
                                   assembler silently produces wrong output.
    -fwrapv                        signed overflow wraps (EVAL.CPP relies on it
                                   for hex constants >= $80000000).
    -fno-strict-aliasing           1980s/90s C code; no type-based aliasing.
    -fwasm-exceptions              the sources use try / catch(...) throughout.

.PARAMETER Optimization
  -O level, default -O2.

.PARAMETER NoUbGuards
  Omit -ftrivial-auto-var-init=zero / -fwrapv / -fno-strict-aliasing, to
  reproduce the miscompiled build described in docs\porting\toolchain.md.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle-wasm.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet('-O0', '-O1', '-O2', '-O3', '-Os', '-Oz')]
    [string]$Optimization = '-O2',
    [switch]$NoUbGuards,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$reference = Join-Path $root 'reference\easy68k-asm-cli\ASM68Kv5.15.4'
$src       = Join-Path $root 'build\oracle\asm-cli-5.15.4\src'
if (-not $OutDir) { $OutDir = Join-Path $root 'build\oracle\asm-cli-5.15.4-wasm' }

if (-not (Test-Path (Join-Path $src 'ASSEMBLE.CPP'))) {
    throw "Sources not found in $src - run tools\build-asm-oracle.ps1 first."
}
foreach ($f in Get-ChildItem $reference -File) {
    $a = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash (Join-Path $src $f.Name) -Algorithm SHA256).Hash
    if ($a -ne $b) { throw "$($f.Name) in $src differs from the reference; re-run tools\build-asm-oracle.ps1." }
}
Write-Host "Sources in $src are byte-identical to the reference."

. (Join-Path $PSScriptRoot 'emsdk-env.ps1') -Quiet
if (-not (Get-Command em++ -ErrorAction SilentlyContinue)) { throw 'em++ not on PATH after emsdk-env.ps1' }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$sources = (Get-ChildItem (Join-Path $src '*.CPP') | Sort-Object Name).FullName

$compile = @($Optimization, '-fwasm-exceptions', '-w')
if (-not $NoUbGuards) { $compile += @('-ftrivial-auto-var-init=zero', '-fwrapv', '-fno-strict-aliasing') }
$link = @(
    '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node',
    '-sINVOKE_RUN=0', '-sEXPORTED_RUNTIME_METHODS=callMain,FS',
    '-sFORCE_FILESYSTEM=1', '-sALLOW_MEMORY_GROWTH=1'
)
$out = Join-Path $OutDir 'asy68k.mjs'
$log = Join-Path $OutDir 'build.log'

Write-Host ("em++ <{0} sources> {1} {2} -o {3}" -f $sources.Count, ($compile -join ' '), ($link -join ' '), $out)
$ErrorActionPreference = 'Continue'
& em++ @sources @compile @link -o $out *> $log
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) {
    Get-Content $log | Write-Host
    throw "em++ failed (exit $code); log: $log"
}

$ver = (& emcc --version | Select-Object -First 1)
Write-Host ""
Write-Host "Built    : $out"
foreach ($n in 'asy68k.mjs', 'asy68k.wasm') {
    $p = Join-Path $OutDir $n
    Write-Host ("  {0,-12} {1,9:N0} bytes  SHA256 {2}" -f $n, (Get-Item $p).Length, (Get-FileHash $p -Algorithm SHA256).Hash)
}
Write-Host "Compiler : $ver"
Write-Host "Run with : node `"$(Join-Path $OutDir 'run-asy68k.mjs')`" [--crt-text-mode] [asy68k options] file.X68"
