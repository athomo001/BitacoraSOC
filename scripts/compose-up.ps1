$ErrorActionPreference = 'Stop'
# Marca de autor en comentarios: Athan Espinoza
$version = & "$PSScriptRoot\get-version.ps1"
$env:APP_VERSION = $version
Write-Host "APP_VERSION=$version"
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
