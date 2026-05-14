# Sirve esta carpeta por HTTP (evita limitaciones de file:// en Chrome/Brave/Edge).
# Nota: en PowerShell, usar pnpm.cmd evita bloqueos de ExecutionPolicy.
# Este script usa Python si existe, o pnpm invocado via cmd.exe / pnpm.cmd.
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
  $pnpmCmd = Join-Path $nodeDir "pnpm.cmd"
  if (Test-Path -LiteralPath $pnpmCmd) {
    & $pnpmCmd dlx serve -l $port
    exit $LASTEXITCODE
  }
}

# Fallback: cmd resuelve pnpm.cmd del PATH
$cmd = "cd /d `\"$PSScriptRoot`\" && pnpm dlx serve -l $port"
cmd.exe /c $cmd
exit $LASTEXITCODE
