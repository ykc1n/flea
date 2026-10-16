param(
  [long[]]$BattleIds = @(2524251, 2525057),
  [ValidateRange(1, 10)][int]$Repeats = 2,
  [string]$SeedCache = '',
  [string]$OutputDirectory = '',
  [ValidateRange(250, 10000)][int]$SampleMilliseconds = 1000
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This resource sampler currently requires Windows.' }
$project = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $project ('data/benchmarks/' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$root = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $root) { throw 'Use a new benchmark output directory.' }
if (-not (Test-Path (Join-Path $project 'dist/scripts/benchmark-case.js'))) { throw 'Run npm run build first.' }
New-Item -ItemType Directory -Path $root | Out-Null
$machine = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); cpu = $cpu.Name; physicalCores = $cpu.NumberOfCores
  logicalProcessors = $cpu.NumberOfLogicalProcessors; ramBytes = $machine.TotalPhysicalMemory
  node = (& $node --version); seedCache = $SeedCache; sampleMilliseconds = $SampleMilliseconds
  otherEngineProcessesAtStart = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'spring%'" | Select-Object ProcessId,Name)
  note = 'CPU is sampled accumulated process CPU; memory is sampled concurrent process-tree usage. Short-lived processes may be missed. Working sets may double-count shared pages. Seed copy is excluded.'
} | ConvertTo-Json | Set-Content (Join-Path $root 'machine.json')
if ($SeedCache) {
  $source = (Resolve-Path -LiteralPath $SeedCache).Path
  $cache = Join-Path $root 'zero-k'
  New-Item -ItemType Directory -Path $cache | Out-Null
  # Copy only reusable dependencies, never a lobby's settings, widgets or logs.
  foreach ($name in @('engine', 'games', 'maps', 'packages', 'pool', 'rapid')) {
    $item = Join-Path $source $name
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination $cache -Recurse }
  }
}
$results = @()
foreach ($battle in $BattleIds) {
  if ($battle -le 0) { throw 'Battle IDs must be positive.' }
  for ($iteration = 1; $iteration -le $Repeats; $iteration++) {
    $label = "$battle-run-$iteration"
    Write-Host "Benchmark $label; output: $root"
    $out = Join-Path $root "$label.stdout.log"
    $err = Join-Path $root "$label.stderr.log"
    $arguments = '"' + (Join-Path $project 'dist/scripts/benchmark-case.js') + '" "' + $root + '" ' + $battle + ' ' + $iteration
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $child = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $known = [Collections.Generic.HashSet[int]]::new()
    [void]$known.Add($child.Id)
    $cpuByProcess = @{}
    $samples = [Collections.Generic.List[object]]::new()
    $finished = $false
    try {
      do {
        $tree = @(Get-CimInstance Win32_Process)
        do {
          $added = $false
          foreach ($entry in $tree) {
            if ($known.Contains([int]$entry.ParentProcessId) -and $known.Add([int]$entry.ProcessId)) { $added = $true }
          }
        } while ($added)
        [long]$working = 0; [long]$private = 0; [long]$enginePeak = 0
        foreach ($entry in $tree) {
          if (-not $known.Contains([int]$entry.ProcessId)) { continue }
          $identity = "$($entry.ProcessId)-$($entry.CreationDate)"
          $cpuByProcess[$identity] = ([double]$entry.KernelModeTime + [double]$entry.UserModeTime) / 10000000
          $working += [long]$entry.WorkingSetSize
          $private += [long]$entry.PrivatePageCount
          if ($entry.Name -like 'spring*') { $enginePeak = [Math]::Max($enginePeak, [long]$entry.PeakWorkingSetSize * 1024) }
        }
        $phase = if (Test-Path (Join-Path $root 'phase.json')) { try { (Get-Content (Join-Path $root 'phase.json') -Raw | ConvertFrom-Json).phase } catch { 'starting' } } else { 'starting' }
        $freeDisk = ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))).AvailableFreeSpace
        $freePhysical = [long](Get-CimInstance Win32_OperatingSystem -Property FreePhysicalMemory).FreePhysicalMemory * 1024
        $samples.Add([pscustomobject]@{ elapsedSeconds = $watch.Elapsed.TotalSeconds; phase = $phase; workingSetBytes = $working; privateBytes = $private; engineLifetimePeakWorkingSetBytes = $enginePeak; freeDiskBytes = $freeDisk; freePhysicalBytes = $freePhysical })
        Start-Sleep -Milliseconds $SampleMilliseconds
        $child.Refresh()
      } while (-not $child.HasExited)
      $child.WaitForExit()
      $finished = $true
    } finally {
      if (-not $finished -and -not $child.HasExited) { & taskkill.exe /PID $child.Id /T /F | Out-Null }
    }
    $watch.Stop()
    $samples | Export-Csv -NoTypeInformation (Join-Path $root "$label.samples.csv")
    $resultPath = Join-Path $root "$label/result.json"
    if (-not (Test-Path $resultPath)) { throw "Benchmark failed before writing a result; inspect $err" }
    $result = Get-Content $resultPath -Raw | ConvertFrom-Json
    $metrics = @{ processWallSeconds = $watch.Elapsed.TotalSeconds
      peakTreeWorkingSetBytes = ($samples | Measure-Object workingSetBytes -Maximum).Maximum
      peakTreePrivateBytes = ($samples | Measure-Object privateBytes -Maximum).Maximum
      engineLifetimePeakWorkingSetBytes = ($samples | Measure-Object engineLifetimePeakWorkingSetBytes -Maximum).Maximum
      minimumFreeDiskBytes = ($samples | Measure-Object freeDiskBytes -Minimum).Minimum
      minimumFreePhysicalBytes = ($samples | Measure-Object freePhysicalBytes -Minimum).Minimum
      sampledCpuSeconds = ($cpuByProcess.Values | Measure-Object -Sum).Sum }
    $result | Add-Member -NotePropertyName resources -NotePropertyValue $metrics
    $result | ConvertTo-Json -Depth 8 | Set-Content $resultPath
    $results += $result
    ConvertTo-Json -InputObject @($results) -Depth 8 | Set-Content (Join-Path $root 'results.json')
    $report = @('# Replay benchmark results', '',
      '| Battle | Run | Status | Engine seconds | Total seconds | Peak tree GiB | Sampled CPU seconds |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: |')
    foreach ($item in $results) {
      $report += '| {0} | {1} | {2} | {3:N1} | {4:N1} | {5:N2} | {6:N1} |' -f $item.id, $item.run, $item.status, $item.stages.engine, $item.totalSeconds, ($item.resources.peakTreeWorkingSetBytes / 1GB), $item.resources.sampledCpuSeconds
    }
    $report += @('', 'See machine.json for hardware and cache seed; per-case result.json for stage timings, private memory, and validation.',
      'Memory is sampled, CPU is a lower bound, and shared working-set pages may be counted more than once. Other host workloads affect timings.')
    $report | Set-Content (Join-Path $root 'report.md')
    Write-Host ("{0}: {1}; engine {2:N1}s; peak tree {3:N0} MiB" -f $label, $result.status, $result.stages.engine, ($metrics.peakTreeWorkingSetBytes / 1MB))
  }
}
Write-Host "Results: $root"
if (@($results | Where-Object { $_.status -ne 'ready' }).Count) { exit 1 }
