# Compila frontend-v2 y copia el resultado al directorio que embebe el
# binario Go (internal/web/dist/browser) - spec/07-backend-arquitectura-go.md
# seccion 1, Fase 3 del roadmap ("//go:embed sirviendo el build de Angular").
# Correr antes de `go build`/`go run` cuando cambie algo en frontend-v2.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Resolve-Path (Join-Path $ScriptDir "..")
$FrontendDir = Resolve-Path (Join-Path $BackendDir "../frontend-v2")
$DestDir = Join-Path $BackendDir "internal/web/dist/browser"

Write-Host "==> pnpm build (frontend-v2)"
Push-Location $FrontendDir
try {
    pnpm run build
} finally {
    Pop-Location
}

Write-Host "==> Copiando dist/frontend-v2/browser -> internal/web/dist/browser"
if (Test-Path $DestDir) {
    Remove-Item -Recurse -Force $DestDir
}
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
Copy-Item -Path (Join-Path $FrontendDir "dist/frontend-v2/browser/*") -Destination $DestDir -Recurse -Force

Write-Host "==> listo"
