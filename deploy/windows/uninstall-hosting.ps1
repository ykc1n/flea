$ErrorActionPreference = 'Stop'
$taskName = 'Flea Replay Explorer'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Output 'Flea automatic hosting has been removed. Application data was preserved.'
