$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $PSScriptRoot 'start-host.ps1'
$taskName = 'Flea Replay Explorer'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersionText = (& $nodePath --version).TrimStart('v')
$fnmNode = Join-Path $env:APPDATA "fnm\node-versions\v$nodeVersionText\installation\node.exe"
if (Test-Path -LiteralPath $fnmNode) { $nodePath = $fnmNode }
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]'22.16.0') { throw "Flea requires Node.js 22.16 or newer; found $nodeVersion at $nodePath" }

Set-Location -LiteralPath $project
& npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -NodePath `"$nodePath`"" `
  -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Hosts the Flea web app and replay discovery worker.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Flea hosting is installed and started. Open http://127.0.0.1:8080"
