$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot '..\release\win-unpacked\LegacyModSuite.exe'
$log = Join-Path $env:TEMP 'Legacy-Mod-Suite-startup.log'
if (-not (Test-Path $exe)) { throw "Packaged executable not found: $exe" }
Remove-Item $log -Force -ErrorAction SilentlyContinue
# Hosted Windows runners can expose a different temp path to PowerShell and
# child processes. Make Electron inherit the exact path the smoke test watches.
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:LEGACY_SUITE_STARTUP_LOG = $log
$process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
$deadline = (Get-Date).AddSeconds(60)
$ready = $false
try {
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) {
            $details = if (Test-Path $log) { Get-Content $log -Raw } else { 'No startup log was written.' }
            throw "Legacy Mod Suite exited with code $($process.ExitCode).`n$details"
        }
        if (Test-Path $log) {
            $contents = Get-Content $log -Raw
            if ($contents -match 'Startup failed:') { throw $contents }
            if ($contents -match 'Interface loaded\.') { $ready = $true; break }
        }
    }
    if (-not $ready) {
        $details = if (Test-Path $log) { Get-Content $log -Raw } else { 'No startup log was written.' }
        throw "The packaged app did not finish startup within 60 seconds.`n$details"
    }
    Write-Host 'Windows smoke test passed: the packaged window loaded the application interface.'
}
finally {
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
