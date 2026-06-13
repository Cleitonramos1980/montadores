param()

$root = "C:\Users\cleit\OneDrive\Documentos\app montadores"

function Stop-Port([int]$port) {
  $pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
  foreach ($pidValue in $pids) {
    if ($pidValue) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      Write-Output "Killed port $port (PID $pidValue)"
    }
  }
}

Stop-Port 5173
Stop-Port 3333

$projectPattern = [regex]::Escape($root)
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    ($_.CommandLine -match $projectPattern) -and
    ($_.CommandLine -match "src/server/index\.ts|vite")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output "Killed stale project process (PID $($_.ProcessId))"
  }

Start-Sleep -Milliseconds 1500

$viteLog = Join-Path $root "vite.log"
$apiLog = Join-Path $root "server.log"
$viteErrLog = Join-Path $root "vite.err.log"
$apiErrLog = Join-Path $root "server.err.log"

Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:web" -WorkingDirectory $root -RedirectStandardOutput $viteLog -RedirectStandardError $viteErrLog -WindowStyle Hidden
Write-Output "Vite started"

Start-Sleep -Milliseconds 500

Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev:api" -WorkingDirectory $root -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog -WindowStyle Hidden
Write-Output "Backend started"
