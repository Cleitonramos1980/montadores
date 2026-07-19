# restart-montadores.ps1 — reinicia todos os serviços de forma segura

param([string]$Service = "all")

function Kill-Port($port) {
    $pids = netstat -ano | Select-String ":$port " | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
    foreach ($p in $pids) { if ($p -match '^\d+$') { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }
}

function Wait-Http($url, $maxSeconds = 30) {
    $elapsed = 0
    while ($elapsed -lt $maxSeconds) {
        try { $null = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing; return $true } catch {}
        Start-Sleep -Seconds 2; $elapsed += 2
    }
    return $false
}

Set-Location $PSScriptRoot

if ($Service -eq "all" -or $Service -eq "web") {
    Write-Host "[web] Matando porta 5173..."
    Kill-Port 5173
    Start-Sleep -Seconds 2
    Write-Host "[web] Reiniciando montadores-web..."
    npx pm2 restart montadores-web --update-env 2>&1 | Out-Null
    if (Wait-Http "http://localhost:5173" 30) { Write-Host "[web] OK" } else { Write-Host "[web] FALHOU" }
}

if ($Service -eq "all" -or $Service -eq "api") {
    Write-Host "[api] Reiniciando montadores-api..."
    npx pm2 restart montadores-api --update-env 2>&1 | Out-Null
    # /api/ready = readiness (503 quando o Oracle está fora); /api/health seria só
    # liveness (sempre 200) e reportaria OK mesmo com o banco indisponível.
    # Invoke-WebRequest lança em 503, então Wait-Http só retorna true em 200.
    if (Wait-Http "http://localhost:3333/api/ready" 30) { Write-Host "[api] OK" } else { Write-Host "[api] FALHOU" }
}

Write-Host "Concluido."
