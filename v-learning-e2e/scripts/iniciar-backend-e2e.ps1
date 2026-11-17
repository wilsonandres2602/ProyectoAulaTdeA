# Levanta el backend de V-Learning contra la base AISLADA de las pruebas E2E (vlearning_e2e).
#
# Úsalo siempre para las pruebas: el .env del backend apunta a la base de desarrollo (vlearning),
# y si DB_URL no se fija en ESTA MISMA ventana, el backend escribe ahí (pasó el 11/11/2026).
#
#   powershell -ExecutionPolicy Bypass -File scripts\iniciar-backend-e2e.ps1
#
# Opcional: -Base otra_base  -Puerto 5433  -App "ruta\a\v-learning-platform"
param(
  [string]$Base = "vlearning_e2e",
  [int]$Puerto = 5433,
  [string]$App = (Join-Path $PSScriptRoot "..\..\v-learning-platform")
)

$ErrorActionPreference = "Stop"
$backend = Join-Path (Resolve-Path $App) "backend\learning-platform"
if (-not (Test-Path (Join-Path $backend "mvnw.cmd"))) { throw "No encuentro el backend en $backend (usa -App)." }

# Si ya hay algo escuchando en el 8080, no se arranca otro backend encima.
$ocupado = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:8080\s+\S+\s+(LISTENING|ESCUCHANDO)"
if ($ocupado) { throw "El puerto 8080 ya está en uso. Detén el backend anterior antes de iniciar este." }

# Lee CLAVE=valor de un archivo .env (quita comillas simples o dobles). $null si no está.
function Leer-Env([string]$archivo, [string]$clave) {
  if (-not (Test-Path $archivo)) { return $null }
  foreach ($linea in Get-Content -LiteralPath $archivo -Encoding UTF8) {
    if ($linea -match "^\s*$clave\s*=(.*)$") { return $Matches[1].Trim().Trim("'").Trim('"') }
  }
  return $null
}

# Comprobación informativa: ¿existe la base aislada? (se crea con los pasos 1 y 2 de «Levantar la app»
# en CLAUDE.md). NUNCA detiene el script: si psql falla (sin contraseña, servidor apagado…) solo avisa
# y sigue; la sonda de support/verificar-base.js detiene la corrida de pruebas si la base no es la correcta.
# La contraseña sale, igual que en support/verificar-base.js, de DB_PASSWORD del .env de las pruebas
# o, si falta, del .env del backend.
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
if (Test-Path $psql) {
  $clave = Leer-Env (Join-Path $PSScriptRoot "..\.env") "DB_PASSWORD"
  if (-not $clave) { $clave = Leer-Env (Join-Path $backend ".env") "DB_PASSWORD" }
  $previo = $ErrorActionPreference
  $ErrorActionPreference = "Continue"   # solo en este bloque: el stderr de psql no debe volverse un error que pare todo
  $existe = $null
  $codigo = 1
  try {
    if ($clave) { $env:PGPASSWORD = $clave }
    # -w: nunca pide la contraseña por teclado.
    $existe = & $psql -w -h localhost -p $Puerto -U postgres -d postgres -At -c "select 1 from pg_database where datname = '$Base'" 2>$null
    $codigo = $LASTEXITCODE
  } catch {
    $codigo = 1
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $ErrorActionPreference = $previo
  }
  if ($codigo -ne 0) {
    Write-Warning "No pude comprobar con psql que exista la base $Base (¿falta DB_PASSWORD o el servidor no responde?). Sigo igual."
  } elseif ("$existe".Trim() -ne "1") {
    Write-Warning "La base $Base no aparece en localhost:$Puerto. Créala con los pasos 1 y 2 de CLAUDE.md; el backend no podrá conectarse. Sigo igual."
  } else {
    Write-Host "Base $Base encontrada en localhost:$Puerto." -ForegroundColor Green
  }
}

$env:DB_URL = "jdbc:postgresql://localhost:$Puerto/$Base"
$env:VLEARNING_DEV_EXPONER_SECRETOS = "true"
Write-Host "Backend E2E -> $env:DB_URL (VLEARNING_DEV_EXPONER_SECRETOS=true)" -ForegroundColor Green
Write-Host "Las pruebas verifican la base al empezar (support/verificar-base.js)." -ForegroundColor Green
Set-Location $backend
& .\mvnw.cmd spring-boot:run
