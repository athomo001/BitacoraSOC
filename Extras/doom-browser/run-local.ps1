# Sirve esta carpeta por HTTP (evita limitaciones de file:// en Chrome/Brave/Edge).
# Nota: en PowerShell, "npx" suele resolver a npx.ps1 y puede fallar por ExecutionPolicy.
# Este script usa Python si existe, o npx invocado via cmd.exe / npx.cmd.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 5173
Write-Host "Sirviendo doom-browser en http://127.0.0.1:$port/ (Ctrl+C para detener)" -ForegroundColor Cyan

if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $port
  exit $LASTEXITCODE
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $nodeDir = Split-Path -Parent $node.Source
  $npxCmd = Join-Path $nodeDir "npx.cmd"
  if (Test-Path -LiteralPath $npxCmd) {
    & $npxCmd --yes serve -l $port
    exit $LASTEXITCODE
  }
}

# Fallback: cmd resuelve npx.cmd del PATH sin pasar por npx.ps1
$cmd = "cd /d `"$PSScriptRoot`" && npx --yes serve -l $port"
cmd.exe /c $cmd
exit $LASTEXITCODE
