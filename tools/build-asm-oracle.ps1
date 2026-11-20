<#
.SYNOPSIS
  Rebuilds the native Windows reference oracle: the third-party command-line
  port of the EASy68K assembler (ASM68K v5.15.4, "asy68k"), compiled with MSVC.

.DESCRIPTION
  1. Copies the read-only reference sources
         <project>\reference\easy68k-asm-cli\ASM68Kv5.15.4\*
     to  <project>\build\oracle\asm-cli-5.15.4\src        (wiped first)
  2. Applies <project>\tests\oracle\asm-cli\msvc-port.patch (tracked) with
     "git apply". The patch only ADDS two files (src\msvc-compat\msvc_compat.h
     and src\msvc-compat\unistd.h); no original file is edited.
  3. Verifies that every original file in src is still byte-identical to the
     reference.
  4. Compiles all *.CPP with cl.exe (x64) into
         <project>\build\oracle\asm-cli-5.15.4\bin\asy68k.exe        (Release)
         <project>\build\oracle\asm-cli-5.15.4\bin\asy68k-dbg.exe    (Debug)

  Nothing under <project>\reference is written to.

.PARAMETER Configuration
  Release (default): /O2 /MT            -> bin\asy68k.exe      (the oracle)
  Debug            : /Od /MTd /Zi       -> bin\asy68k-dbg.exe + .pdb (for stepping
                     through the assembler in a debugger and as an unoptimised
                     cross-check of the Release build; it is not the oracle).
                     /RTC1 is deliberately not used (and was not tried): the
                     code reads uninitialised locals, e.g. the return value of
                     SYMBOL.CPP lookup() for a symbol that is not found, which
                     is exactly what /RTCu is designed to trap
                     (see docs\porting\toolchain.md).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle.ps1 -Configuration Debug

.NOTES
  Oracle usage (see docs\porting\toolchain.md):
      asy68k.exe [options] file.X68
  writes file.L68 and file.S68 NEXT TO THE SOURCE FILE.
#>
[CmdletBinding()]
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$reference = Join-Path $root 'reference\easy68k-asm-cli\ASM68Kv5.15.4'
$oracle    = Join-Path $root 'build\oracle\asm-cli-5.15.4'
$src       = Join-Path $oracle 'src'
$patch     = Join-Path $root 'tests\oracle\asm-cli\msvc-port.patch'
$bin       = Join-Path $oracle 'bin'
$obj       = Join-Path $oracle ("obj\" + $Configuration.ToLower())

if (-not (Test-Path (Join-Path $reference 'ASSEMBLE.CPP'))) { throw "Reference sources not found: $reference" }
if (-not (Test-Path $patch)) { throw "Patch not found: $patch" }

# ---- locate MSVC (vcvars64.bat) ------------------------------------------
$vcvars = $null
$candidates = @(
    'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat'
)
foreach ($c in $candidates) { if (Test-Path $c) { $vcvars = $c; break } }
if (-not $vcvars) {
    $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($inst) {
            $c = Join-Path $inst 'VC\Auxiliary\Build\vcvars64.bat'
            if (Test-Path $c) { $vcvars = $c }
        }
    }
}
if (-not $vcvars) { throw 'vcvars64.bat not found: install the "Desktop development with C++" workload of Visual Studio 2022.' }

# ---- 1. fresh copy of the reference sources --------------------------------
if (Test-Path $src) { Remove-Item -Recurse -Force $src }
New-Item -ItemType Directory -Force $src, $bin, $obj | Out-Null
Copy-Item (Join-Path $reference '*') $src -Recurse -Force
Write-Host "Copied reference sources -> $src"

# ---- 2. apply the patch ------------------------------------------------------
# GIT_CEILING_DIRECTORIES stops git from discovering an enclosing repository, so
# "git apply" treats the oracle directory as a plain directory tree.
$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = (Split-Path -Parent $oracle)
Push-Location $oracle
try {
    & git apply --whitespace=nowarn $patch
    if ($LASTEXITCODE -ne 0) { throw "git apply failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
}
Write-Host "Applied $patch"

# ---- 3. the original files must be untouched -------------------------------
$changed = @()
$refFiles = Get-ChildItem $reference -File
foreach ($f in $refFiles) {
    $a = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash (Join-Path $src $f.Name) -Algorithm SHA256).Hash
    if ($a -ne $b) { $changed += $f.Name }
}
if ($changed.Count) {
    Write-Host ("NOTE: files modified by the patch: " + ($changed -join ', '))
} else {
    Write-Host ("All {0} original files are byte-identical to the reference (the patch only adds files)." -f $refFiles.Count)
}

# ---- 4. compile ---------------------------------------------------------------
if ($Configuration -eq 'Release') {
    $exe   = Join-Path $bin 'asy68k.exe'
    $flags = '/O2 /MT'
} else {
    $exe   = Join-Path $bin 'asy68k-dbg.exe'
    $flags = '/Od /MTd /Zi'
}
$pdb = [IO.Path]::ChangeExtension($exe, '.pdb')
$common = '/nologo /EHsc /W3 /D_CRT_SECURE_NO_WARNINGS /D_CRT_NONSTDC_NO_WARNINGS /FI msvc_compat.h'
$cl = "cl $common $flags /I `"$src\msvc-compat`" /Fo`"$obj\\`" /Fd`"$pdb`" /Fe`"$exe`" `"$src\*.CPP`""
$log = Join-Path $obj 'build.log'

Write-Host "Compiling ($Configuration): $cl"
$ErrorActionPreference = 'Continue'
& cmd.exe /d /c "`"$vcvars`" >nul 2>&1 && $cl" *> $log
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) {
    Get-Content $log | Write-Host
    throw "cl failed (exit $code); log: $log"
}
$warnings = @(Select-String -Path $log -Pattern ': warning ').Count
$clVersion = (& cmd.exe /d /c "`"$vcvars`" >nul 2>&1 && cl 2>&1" | Select-Object -First 1)

Write-Host ""
Write-Host "Built    : $exe"
Write-Host ("Size     : {0:N0} bytes" -f (Get-Item $exe).Length)
Write-Host ("SHA256   : " + (Get-FileHash $exe -Algorithm SHA256).Hash)
Write-Host "Compiler : $clVersion"
Write-Host "Warnings : $warnings (see $log)"
