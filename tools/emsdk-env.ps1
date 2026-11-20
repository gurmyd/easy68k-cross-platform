<#
.SYNOPSIS
  Puts the project-local Emscripten SDK (emcc / em++ / emar ...) on PATH for the
  CURRENT PowerShell process only. Nothing is written to the registry, to the
  user profile or to the machine/user PATH.

.USAGE
  . c:\easy64k\tools\emsdk-env.ps1          # dot-source it (note the leading dot)
  . c:\easy64k\tools\emsdk-env.ps1 -Quiet   # same, without the banner

  After that, in the same shell:
      emcc --version
      em++ hello.cpp -o hello.mjs ...

.NOTES
  The SDK lives in <project>\.toolchain\emsdk and was installed with
      git clone --depth 1 https://github.com/emscripten-core/emsdk.git
      emsdk.bat install latest
      emsdk.bat activate latest        (no --permanent / --system)
  See docs\porting\toolchain.md.

  This script does NOT call "emsdk construct_env" (slow, needs Python start-up);
  it sets the same variables directly from the installed layout:
      PATH          += <emsdk>; <emsdk>\upstream\emscripten
      EMSDK          = <emsdk>            (forward slashes, as emsdk does)
      EMSDK_NODE     = <emsdk>\node\<ver>\node.exe
      EMSDK_PYTHON   = <emsdk>\python\<ver>\python.exe
      EM_CONFIG      = <emsdk>\.emscripten
  Works in Windows PowerShell 5.1 and PowerShell 7.
#>
param(
    [switch]$Quiet
)

$__emRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.toolchain\emsdk'
if (-not (Test-Path (Join-Path $__emRoot 'upstream\emscripten\emcc.py'))) {
    Write-Error "Emscripten SDK not found (or not installed) at $__emRoot. See docs\porting\toolchain.md for the install commands."
    return
}
if (-not (Test-Path (Join-Path $__emRoot '.emscripten'))) {
    Write-Error "$__emRoot\.emscripten is missing: run '$__emRoot\emsdk.bat activate latest' once."
    return
}
$__emRoot = (Resolve-Path $__emRoot).Path

# Newest bundled node / python (emsdk installs exactly one of each).
$__emNode = Get-ChildItem (Join-Path $__emRoot 'node') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
$__emPy = Get-ChildItem (Join-Path $__emRoot 'python') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1

$env:EMSDK = $__emRoot -replace '\\', '/'
$env:EM_CONFIG = Join-Path $__emRoot '.emscripten'
if ($__emNode) { $env:EMSDK_NODE = Join-Path $__emNode.FullName 'node.exe' }
if ($__emPy) { $env:EMSDK_PYTHON = Join-Path $__emPy.FullName 'python.exe' }

# Prepend to the process PATH, once.
$__emAdd = @($__emRoot, (Join-Path $__emRoot 'upstream\emscripten'))
$__emParts = $env:PATH -split ';' | Where-Object { $_ -and ($__emAdd -notcontains $_.TrimEnd('\')) }
$env:PATH = (($__emAdd + $__emParts) -join ';')

if (-not $Quiet) {
    $__emVer = Get-Content (Join-Path $__emRoot 'upstream\emscripten\emscripten-version.txt') -ErrorAction SilentlyContinue
    Write-Host ("Emscripten {0} ready for this shell (EMSDK={1})" -f ($__emVer -replace '"', ''), $env:EMSDK)
}

# Dot-sourcing runs in the caller's scope: do not leave helper variables behind.
Remove-Variable __emRoot, __emNode, __emPy, __emAdd, __emParts, __emVer, Quiet -ErrorAction SilentlyContinue
