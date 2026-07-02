# ── App Montadores — Startup Automatico ─────────────────────────────────────
# Inicia backend + frontend + tunel Cloudflare e atualiza o Worker

$PROJECT     = "C:\Users\cleit\OneDrive\Documentos\app montadores"
$ACCOUNT_ID  = "b1d7492882563fb5cac0e451fe75d567"
$WORKER_NAME = "appmontadores"
$WORKER_URL  = "https://appmontadores.cleiton-aramos1980.workers.dev"

# Carrega token do .env
$CF_TOKEN = $null
Get-Content (Join-Path $PROJECT ".env") | ForEach-Object {
    if ($_ -match "^CF_API_TOKEN=(.+)$") { $CF_TOKEN = $Matches[1].Trim() }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   App Montadores — Inicializando...        " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Backend Express (porta 3333) ─────────────────────────────────────────
Write-Host "[1/4] Backend (porta 3333)..." -ForegroundColor Yellow
Start-Process "cmd" -ArgumentList "/k", "title Backend-3333 && cd /d `"$PROJECT`" && npx tsx src/server/index.ts"
Start-Sleep -Seconds 5

# ── 2. Frontend Vite (porta 5173) ────────────────────────────────────────────
Write-Host "[2/4] Frontend (porta 5173)..." -ForegroundColor Yellow
Start-Process "cmd" -ArgumentList "/k", "title Frontend-5173 && cd /d `"$PROJECT`" && npx vite"
Start-Sleep -Seconds 8

# ── 3. Cloudflare Quick Tunnel ───────────────────────────────────────────────
Write-Host "[3/4] Iniciando Cloudflare Tunnel..." -ForegroundColor Yellow
$logFile = "$env:TEMP\cf_tunnel.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }

Start-Process "cloudflared" `
    -ArgumentList "tunnel --url http://localhost:5173 --logfile `"$logFile`"" `
    -WindowStyle Hidden

# Aguarda URL aparecer no log (ate 90s)
$tunnelUrl = $null
$timeout   = 90
$elapsed   = 0
Write-Host "   Aguardando URL... " -NoNewline -ForegroundColor Gray

while (-not $tunnelUrl -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 3
    $elapsed += 3
    Write-Host "." -NoNewline -ForegroundColor Gray
    if (Test-Path $logFile) {
        $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        # JSON format
        if ($content -match '"url"\s*:\s*"(https://[\w-]+\.trycloudflare\.com)"') {
            $tunnelUrl = $Matches[1]
        }
        # Plain text / message field
        if (-not $tunnelUrl -and $content -match 'https://[\w-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
        }
    }
}
Write-Host ""

if (-not $tunnelUrl) {
    Write-Host "   ERRO: Tunel nao iniciou em $timeout segundos." -ForegroundColor Red
    Write-Host "   Verifique se o cloudflared esta instalado: cloudflared --version" -ForegroundColor Red
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Write-Host "   Tunel ativo: $tunnelUrl" -ForegroundColor Green

# ── 4. Atualizar Cloudflare Worker via API ───────────────────────────────────
Write-Host "[4/4] Atualizando Worker Cloudflare..." -ForegroundColor Yellow

$workerScript = @"
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const TARGET = '$tunnelUrl'
  const inUrl = new URL(request.url)
  const target = TARGET + inUrl.pathname + inUrl.search
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.delete('host')
  headers.set('ngrok-skip-browser-warning', 'true')
  const init = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
    redirect: 'manual',
  }
  const resp = await fetch(target, init)
  return new Response(resp.body, { status: resp.status, headers: resp.headers })
}
"@

try {
    $resp = Invoke-RestMethod `
        -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME" `
        -Method Put `
        -Headers @{ "Authorization" = "Bearer $CF_TOKEN"; "Content-Type" = "application/javascript" } `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($workerScript))

    if ($resp.success) {
        Write-Host "   Worker atualizado com sucesso!" -ForegroundColor Green
    } else {
        Write-Host "   Erro: $($resp.errors | ConvertTo-Json -Compress)" -ForegroundColor Red
    }
} catch {
    Write-Host "   Erro na API: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   SISTEMA PRONTO!                          " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   URL permanente:" -ForegroundColor White
Write-Host "   $WORKER_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Mantenha esta janela aberta."  -ForegroundColor Gray
Write-Host "   Fechar encerra o tunel."       -ForegroundColor Gray
Write-Host ""
Read-Host "Pressione Enter para fechar esta janela (tunel continua rodando)"
