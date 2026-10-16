param([string]$NodePath = 'node.exe')

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $project

if (-not $env:FLEA_DB) { $env:FLEA_DB = Join-Path $project 'data\flea.sqlite3' }
if (-not $env:FLEA_DATA) { $env:FLEA_DATA = Join-Path $project 'data' }
$logDirectory = Join-Path $project 'data\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$hostScript = Join-Path $project 'dist\src\host.js'
$standardLog = Join-Path $logDirectory 'host.log'
$errorLog = Join-Path $logDirectory 'host-error.log'
$hostProcess = Start-Process `
  -FilePath $NodePath `
  -ArgumentList @($hostScript) `
  -WorkingDirectory $project `
  -WindowStyle Hidden `
  -RedirectStandardOutput $standardLog `
  -RedirectStandardError $errorLog `
  -PassThru
$hostProcess.WaitForExit()
exit $hostProcess.ExitCode
