# Compila frontend-v2/ y copia el resultado a
# backend-go/internal/web/dist/browser/ (el //go:embed de internal/web/spa.go)
# para poder correr `go run`/`go build` en local SIN pasar por Docker.
#
# El Dockerfile hace lo mismo dentro del build multi-stage (stage
# `frontend-build` + COPY); este script existe para el flujo de desarrollo
# local fuera de Docker.
$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path "$PSScriptRoot\.."

Set-Location "$repoRoot\frontend-v2"
pnpm install --frozen-lockfile
pnpm run build

$target = "$repoRoot\backend-go\internal\web\dist\browser"
if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Recurse -Force "$repoRoot\frontend-v2\dist\frontend-v2\browser\*" $target

Write-Host "Frontend sincronizado en $target"
