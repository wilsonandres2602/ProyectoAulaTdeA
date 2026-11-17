# Ejecuta las pruebas E2E de V-Learning de principio a fin con un solo clic (EJECUTAR_PRUEBAS.bat).
#
#  1. Instala dependencias si faltan (npm ci + Chromium de Playwright).
#  2. Arranca lo que no esté corriendo, cada uno en su propia ventana minimizada:
#       - backend contra la base aislada vlearning_e2e (scripts\iniciar-backend-e2e.ps1)
#       - frontend (npm run dev en ..\v-learning-platform\frontend, puerto 5173)
#  3. Espera a que los dos respondan.
#  4. Corre la suite elegida (menú) y luego: cadena de hashes, Excel e informe Word/PDF.
#  5. Muestra el resumen, abre el reporte HTML y la carpeta resultados\.
#  6. Detiene el backend y el frontend que haya arrancado él (los que ya estaban, los deja).
#
# Uso sin menú (p. ej. programado):
#   powershell -ExecutionPolicy Bypass -File scripts\ejecutar-pruebas.ps1 -Modo normal -NoAbrir
#   ... -Modo hu -Grep HU-002
param(
  [ValidateSet("menu", "normal", "p1", "visible", "lentos", "hu")] [string]$Modo = "menu",
  [string]$Grep = "",
  [switch]$SinInforme,
  [switch]$NoAbrir
)

$ErrorActionPreference = "Stop"
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$appRuta = Join-Path $raiz "..\v-learning-platform"
if (-not (Test-Path $appRuta)) { throw "No encuentro la app en $appRuta (debe estar al lado de v-learning-e2e)." }
$app = (Resolve-Path $appRuta).Path
$frontend = Join-Path $app "frontend"
Set-Location $raiz

function Titulo($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function PuertoEnUso([int]$p) { [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }

function BackendListo {
  try {
    Invoke-WebRequest -Uri "http://localhost:8080/api/auth/login" -Method Post -ContentType "application/json" `
      -Body "{}" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    $r = $_.Exception.Response
    if ($null -eq $r) { return $false }
    $c = [int]$r.StatusCode
    return ($c -eq 400 -or $c -eq 401)
  }
}

function FrontendListo {
  try { Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true } catch { return $false }
}

function Esperar([string]$nombre, [scriptblock]$listo, [int]$segundos) {
  Write-Host -NoNewline "Esperando $nombre "
  $fin = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fin) {
    if (& $listo) { Write-Host " listo." -ForegroundColor Green; return }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 3
  }
  Write-Host ""
  throw "$nombre no respondió en $segundos s. Revisa su ventana (está minimizada en la barra de tareas)."
}

$iniciados = @()
try {
  # ---------------------------------------------------------------- 1. Preparación
  Titulo "Preparación"
  if (-not (Test-Path (Join-Path $raiz ".env"))) {
    throw "Falta el archivo .env. Copia .env.example como .env y llena las contraseñas (entre comillas simples)."
  }
  if (-not (Test-Path (Join-Path $raiz "node_modules"))) {
    Write-Host "Instalando dependencias de las pruebas..."
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci falló." }
    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar Chromium de Playwright." }
  }
  if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Instalando dependencias del frontend..."
    Push-Location $frontend; & npm.cmd ci; $ok = $LASTEXITCODE -eq 0; Pop-Location
    if (-not $ok) { throw "npm ci del frontend falló." }
  }
  Write-Host "Dependencias OK." -ForegroundColor Green

  # ---------------------------------------------------------------- 2. Backend y frontend
  Titulo "Aplicación"
  if (PuertoEnUso 8080) {
    Write-Host "Ya hay un backend en el 8080: se usa ese. Si no escribe en vlearning_e2e, la corrida se detiene sola." -ForegroundColor Yellow
  } else {
    Write-Host "Arrancando el backend (base vlearning_e2e) en otra ventana..."
    $iniciados += Start-Process powershell.exe -WindowStyle Minimized -PassThru -ArgumentList @(
      "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$raiz\scripts\iniciar-backend-e2e.ps1`"")
  }
  if (PuertoEnUso 5173) {
    Write-Host "Ya hay un frontend en el 5173: se usa ese." -ForegroundColor Yellow
  } else {
    Write-Host "Arrancando el frontend en otra ventana..."
    $iniciados += Start-Process cmd.exe -WindowStyle Minimized -PassThru -WorkingDirectory $frontend `
      -ArgumentList @("/k", "npm run dev -- --port 5173 --strictPort")
  }
  Esperar "el backend (http://localhost:8080)" { BackendListo } 300
  Esperar "el frontend (http://localhost:5173)" { FrontendListo } 120

  # ---------------------------------------------------------------- 3. Qué correr
  if ($Modo -eq "menu") {
    Titulo "¿Qué pruebas quieres correr?"
    Write-Host "  1) Suite normal, sin las lentas   (recomendado)"
    Write-Host "  2) Solo prioridad P1"
    Write-Host "  3) Suite normal con el navegador visible"
    Write-Host "  4) Solo las lentas (esperan 15-30 min por caso)"
    Write-Host "  5) Una sola historia de usuario (p. ej. HU-002)"
    $op = Read-Host "Opción [1]"
    $Modo = switch ($op) { "2" { "p1" } "3" { "visible" } "4" { "lentos" } "5" { "hu" } default { "normal" } }
    if ($Modo -eq "hu") { $Grep = Read-Host "Historia (p. ej. HU-002)" }
  }
  if ($Modo -eq "hu") {
    $Grep = $Grep.Trim().ToUpper()
    if ($Grep -notmatch '^HU-\d{3}$') { throw "Escribe la historia como HU-002." }
  }

  # ---------------------------------------------------------------- 4. Pruebas
  Titulo "Pruebas ($Modo$(if ($Modo -eq 'hu') { " $Grep" }))"
  $inicio = Get-Date
  switch ($Modo) {
    "normal"  { & npm.cmd run test:e2e }
    "p1"      { & npm.cmd run test:p1 }
    "visible" { & npm.cmd run test:ver }
    "lentos"  { & npm.cmd run test:lentos }
    "hu"      { & npx.cmd playwright test --grep "@$Grep" --grep-invert "@lento" }
  }
  $codigoPruebas = $LASTEXITCODE
  $duracion = (Get-Date) - $inicio

  # ---------------------------------------------------------------- 5. Resultados
  Titulo "Historial, Excel e informe"
  & npm.cmd run auditoria:verificar
  if (-not $SinInforme) {
    & npm.cmd run auditoria:excel
    & npm.cmd run informe
  }

  Titulo "Resumen"
  $ultimo = Join-Path $raiz "resultados\ultimo.json"
  if (Test-Path $ultimo) {
    $s = (Get-Content $ultimo -Raw -Encoding UTF8 | ConvertFrom-Json).stats
    Write-Host ("Pasaron: {0}   Fallaron: {1}   Saltados/bloqueados: {2}   Inestables: {3}" -f $s.expected, $s.unexpected, $s.skipped, $s.flaky)
  }
  Write-Host ("Duración: {0:hh\:mm\:ss}" -f $duracion)
  if ($codigoPruebas -ne 0) {
    Write-Host "Hay casos fallidos. Los defectos conocidos (D-xx) fallan a propósito: revisa la hoja «Incidentes» del Excel." -ForegroundColor Yellow
  } else { Write-Host "Todos los casos ejecutados pasaron." -ForegroundColor Green }
  Write-Host "Resultados en: $raiz\resultados"
  Write-Host "Evidencias en: $raiz\evidencias"

  if (-not $NoAbrir) {
    Start-Process explorer.exe (Join-Path $raiz "resultados")
    # El reporte se sirve por http para que también abran los traces; ciérralo cerrando su ventana.
    Start-Process cmd.exe -WorkingDirectory $raiz -ArgumentList @("/k", "npx playwright show-report")
  }
}
catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($iniciados.Count -gt 0) {
    $detener = if ($Modo -ne "menu" -and $NoAbrir) { "s" } else { Read-Host "`n¿Detener el backend y el frontend que se arrancaron? (S/n)" }
    if ($detener -ne "n") {
      foreach ($p in $iniciados) { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null }
      Write-Host "Backend y frontend detenidos."
    }
  }
}
