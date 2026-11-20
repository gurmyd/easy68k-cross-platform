<#
.SYNOPSIS
  Assembles one .X68 file with the native oracle (asy68k.exe) and with the
  WebAssembly build of the same sources, then compares the .L68 and .S68
  outputs byte for byte.

.DESCRIPTION
  Work directory: <project>\build\oracle\compare\<name>\
      native\         asy68k.exe                                  (Windows CRT text mode)
      wasm-raw\       node run-asy68k.mjs                  file   (bytes copied verbatim)
      wasm-textmode\  node run-asy68k.mjs --crt-text-mode  file   (CRLF/Ctrl-Z emulated)
  The source is copied unchanged into each directory; outputs land next to it.

  Reported for .S68 and .L68:
    raw      : native vs wasm-raw, byte for byte
    textmode : native vs wasm-textmode, byte for byte
    masked   : native vs wasm-textmode after masking the one known, intentional
               difference in the listing header: the "Created On:" line. The
               native build prints "M/D/YYYY h:mm:ss AM" (Borland
               DateTimeToStr form); the wasm build takes the port's non-Windows
               branch and prints asctime(), whose trailing '\n' adds one extra
               empty line. Masking = replace line 3 by "Created On: <masked>"
               in both and drop that extra empty line 4 from the wasm listing.

  Exit code 0 when .S68 is identical in "textmode" and .L68 is identical in
  "masked"; 1 otherwise.

.PARAMETER AsmOptions
  asy68k options, comma separated, e.g. -AsmOptions "--macroexpand,--no-symbols"

.PARAMETER NativeExe
  Use another native build instead of bin\asy68k.exe (e.g. bin\asy68k-dbg.exe).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\compare-asm-oracle.ps1 -Source c:\easy64k\build\oracle\smoke-test\smoke.X68

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\compare-asm-oracle.ps1 -Source c:\easy64k\build\oracle\smoke-test\smoke.X68 -AsmOptions "--macroexpand,--structureexpan,--expandconstants"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string[]]$AsmOptions = @(),
    [string]$WasmDir,
    [string]$NativeExe,
    [string]$Tag            # optional suffix for the work directory: compare\<name>-<Tag>
)

$ErrorActionPreference = 'Stop'
# "powershell -File" passes "-AsmOptions a,b" as ONE string: split it here.
$AsmOptions = @($AsmOptions | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
$root   = Split-Path -Parent $PSScriptRoot
$exe    = Join-Path $root 'build\oracle\asm-cli-5.15.4\bin\asy68k.exe'
if ($NativeExe) { $exe = (Resolve-Path $NativeExe).Path }
if (-not $WasmDir) { $WasmDir = Join-Path $root 'build\oracle\asm-cli-5.15.4-wasm' }
$runner = Join-Path $WasmDir 'run-asy68k.mjs'
foreach ($p in $exe, $runner, (Join-Path $WasmDir 'asy68k.wasm'), $Source) {
    if (-not (Test-Path $p)) { throw "Not found: $p" }
}
$node = (Get-Command node -ErrorAction Stop).Source

$Source = (Resolve-Path $Source).Path
$file   = Split-Path -Leaf $Source
$base   = [IO.Path]::GetFileNameWithoutExtension($file)
$work   = Join-Path $root ("build\oracle\compare\" + $base + $(if ($Tag) { '-' + $Tag } else { '' }))

$latin1 = [Text.Encoding]::GetEncoding(28591)   # 1 byte <-> 1 char, lossless

function Invoke-In([string]$dir, [string]$program, [string[]]$arguments) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($ext in '.L68', '.S68') {
        $old = Join-Path $dir ($base + $ext)
        if (Test-Path $old) { Remove-Item -Force $old }
    }
    Copy-Item $Source (Join-Path $dir $file) -Force

    # System.Diagnostics.Process instead of "& program 2>&1": Windows PowerShell
    # 5.1 wraps native stderr lines in error records, which garbles the log.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $program
    $psi.Arguments = (($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    $psi.WorkingDirectory = $dir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $err = $errTask.Result
    [IO.File]::WriteAllText((Join-Path $dir 'console.txt'),
        ("command: {0} {1}`r`nexit code: {2}`r`n--- stdout ---`r`n{3}--- stderr ---`r`n{4}" -f $program, $psi.Arguments, $p.ExitCode, $out, $err))
    return $p.ExitCode
}

function Read-Bytes([string]$path) {
    if (Test-Path $path) { return ,[IO.File]::ReadAllBytes($path) }
    return ,$null
}

function Test-Same($a, $b) {
    if ($null -eq $a -or $null -eq $b) { return $false }
    if ($a.Length -ne $b.Length) { return $false }
    return ($latin1.GetString($a) -ceq $latin1.GetString($b))
}

# Mask the "Created On:" line; drop the extra empty line that asctime() adds.
function Get-MaskedListing($bytes) {
    if ($null -eq $bytes) { return $null }
    $lines = [Collections.Generic.List[string]]($latin1.GetString($bytes) -split "`n")
    if ($lines.Count -gt 3 -and $lines[2].StartsWith('Created On: ')) {
        $cr = ''
        if ($lines[2].EndsWith("`r")) { $cr = "`r" }
        $isAsctime = $lines[2] -cmatch '^Created On: [A-Z][a-z]{2} [A-Z][a-z]{2} '
        $lines[2] = 'Created On: <masked>' + $cr
        if ($isAsctime -and $lines[3].TrimEnd("`r") -eq '') { $lines.RemoveAt(3) }
    }
    return ($lines -join "`n")
}

function Get-FirstDifference([string]$a, [string]$b) {
    $la = $a -split "`n"; $lb = $b -split "`n"
    $n = [Math]::Min($la.Count, $lb.Count)
    for ($i = 0; $i -lt $n; $i++) {
        if ($la[$i] -cne $lb[$i]) {
            return ("line {0}:`n      native: {1}`n      wasm  : {2}" -f ($i + 1), $la[$i].TrimEnd("`r"), $lb[$i].TrimEnd("`r"))
        }
    }
    if ($la.Count -ne $lb.Count) { return ("line counts differ: native {0}, wasm {1}" -f $la.Count, $lb.Count) }
    return 'none'
}

$codeNative = Invoke-In (Join-Path $work 'native')        $exe  ($AsmOptions + $file)
$codeRaw    = Invoke-In (Join-Path $work 'wasm-raw')      $node (@($runner) + $AsmOptions + $file)
$codeText   = Invoke-In (Join-Path $work 'wasm-textmode') $node (@($runner, '--crt-text-mode') + $AsmOptions + $file)

$srcBytes = [IO.File]::ReadAllBytes($Source)
$srcText  = $latin1.GetString($srcBytes)
Write-Host ("Source   : {0} ({1} bytes, {2} CRLF, {3} bare LF)" -f $Source, $srcBytes.Length,
    ([regex]::Matches($srcText, "`r`n").Count), ([regex]::Matches($srcText, "(?<!`r)`n").Count))
Write-Host ("Options  : {0}" -f ($(if ($AsmOptions.Count) { $AsmOptions -join ' ' } else { '(none)' })))
Write-Host ("Exit code: native {0}, wasm-raw {1}, wasm-textmode {2}" -f $codeNative, $codeRaw, $codeText)
Write-Host ("Work dir : {0}" -f $work)
Write-Host ''

$ok = $true
foreach ($ext in '.S68', '.L68') {
    $n = Read-Bytes (Join-Path $work ("native\" + $base + $ext))
    $r = Read-Bytes (Join-Path $work ("wasm-raw\" + $base + $ext))
    $t = Read-Bytes (Join-Path $work ("wasm-textmode\" + $base + $ext))
    $size = { param($x) if ($null -eq $x) { 'missing' } else { '{0} bytes' -f $x.Length } }
    Write-Host ("{0}  native {1} | wasm-raw {2} | wasm-textmode {3}" -f ($base + $ext), (& $size $n), (& $size $r), (& $size $t))
    Write-Host ("    raw      (native vs wasm-raw)      : {0}" -f $(if (Test-Same $n $r) { 'IDENTICAL' } else { 'DIFFERENT' }))
    $sameText = Test-Same $n $t
    Write-Host ("    textmode (native vs wasm-textmode) : {0}" -f $(if ($sameText) { 'IDENTICAL' } else { 'DIFFERENT' }))
    if ($ext -eq '.L68') {
        $mn = Get-MaskedListing $n; $mt = Get-MaskedListing $t
        $sameMasked = ($null -ne $mn) -and ($null -ne $mt) -and ($mn -ceq $mt)
        Write-Host ("    masked   (Created On line masked)  : {0}" -f $(if ($sameMasked) { 'IDENTICAL' } else { 'DIFFERENT' }))
        if (-not $sameMasked) {
            $ok = $false
            if ($null -ne $mn -and $null -ne $mt) { Write-Host ("    first difference at " + (Get-FirstDifference $mn $mt)) }
        }
        if ($null -ne $n -and $null -ne $t) {
            $ln = ($latin1.GetString($n) -split "`n"); $lt = ($latin1.GetString($t) -split "`n")
            if ($ln.Count -gt 2) { Write-Host ("    native header line 3: " + $ln[2].TrimEnd("`r")) }
            if ($lt.Count -gt 2) { Write-Host ("    wasm   header line 3: " + $lt[2].TrimEnd("`r")) }
        }
    }
    elseif (-not $sameText) {
        $ok = $false
        if ($null -ne $n -and $null -ne $t) { Write-Host ("    first difference at " + (Get-FirstDifference ($latin1.GetString($n)) ($latin1.GetString($t)))) }
    }
}
Write-Host ''
if ($ok) { Write-Host 'RESULT: native and wasm agree (S68 byte-identical in text mode; L68 byte-identical apart from the Created On line).'; exit 0 }
else     { Write-Host 'RESULT: native and wasm DIFFER.'; exit 1 }
