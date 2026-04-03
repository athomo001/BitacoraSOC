$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir '..')
$BackupRoot = Join-Path $RootDir '.data\mongo8-migration'

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & docker compose -f (Join-Path $RootDir 'docker-compose.yml') -f (Join-Path $RootDir 'docker-compose.complements.yml') @Args
}

function Get-MongoContainerId {
  $ContainerId = (Invoke-Compose ps -q mongodb | Out-String).Trim()
  if (-not $ContainerId) {
    throw 'No se pudo resolver el contenedor mongodb del compose de Bitacora.'
  }
  return $ContainerId
}

function Show-Usage {
  Write-Host 'Uso:'
  Write-Host '  .\scripts\mongo8-migration.ps1 backup'
  Write-Host '  .\scripts\mongo8-migration.ps1 restore <ruta-backup>'
}

function Wait-ForMongo {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-Compose exec -T mongodb sh -lc 'mongosh --host localhost --port 27017 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "db.runCommand({ ping: 1 }).ok" | grep 1' | Out-Null
      return
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw 'MongoDB no quedó listo a tiempo'
}

function Backup-HostDirectory {
  param(
    [string]$Name,
    [string]$Destination
  )

  $Source = Join-Path $RootDir ".data\$Name"
  if (Test-Path $Source) {
    Compress-Archive -Path $Source -DestinationPath $Destination -Force
  }
}

function Restore-HostArchive {
  param(
    [string]$Archive,
    [string]$Suffix
  )

  if (-not (Test-Path $Archive)) {
    return
  }

  $BaseName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileNameWithoutExtension($Archive))
  $CurrentDir = Join-Path $RootDir ".data\$BaseName"
  if (Test-Path $CurrentDir) {
    Move-Item $CurrentDir (Join-Path $RootDir ".data\${BaseName}_pre_restore_$Suffix")
  }
  Expand-Archive -Path $Archive -DestinationPath (Join-Path $RootDir '.data') -Force
}

function Ensure-Mongo8Declared {
  $ComposeContent = Get-Content (Join-Path $RootDir 'docker-compose.yml') -Raw
  if ($ComposeContent -notmatch 'image:\s+mongo:8') {
    Write-Warning 'docker-compose.yml no parece apuntar a mongo:8. Restaura solo si ya hiciste pull del cambio correcto.'
  }
}

function Do-Backup {
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
  $Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $TargetDir = Join-Path $BackupRoot $Timestamp
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

  Write-Host "[mongo8-migration] Creando dump lógico en $TargetDir"
  Invoke-Compose exec -T mongodb sh -lc 'rm -rf /tmp/mongo8-migration && mkdir -p /tmp/mongo8-migration && mongodump --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin" --out=/tmp/mongo8-migration/dump'
  & docker cp "$(Get-MongoContainerId)`:/tmp/mongo8-migration/dump" (Join-Path $TargetDir 'dump')

  $EnvFile = Join-Path $RootDir '.env'
  if (Test-Path $EnvFile) {
    Copy-Item $EnvFile (Join-Path $TargetDir '.env.backup') -Force
  }

  Backup-HostDirectory -Name 'uploads' -Destination (Join-Path $TargetDir 'uploads.zip')
  Backup-HostDirectory -Name 'tls' -Destination (Join-Path $TargetDir 'tls.zip')
  Backup-HostDirectory -Name 'backups' -Destination (Join-Path $TargetDir 'backups.zip')

  @(
    "created_at=$Timestamp",
    "project_root=$RootDir",
    "mongo_container=$(Get-MongoContainerId)",
    'includes=dump,.env.backup,uploads.zip,tls.zip,backups.zip',
    "restore_with=.\scripts\mongo8-migration.ps1 restore $TargetDir"
  ) | Set-Content (Join-Path $TargetDir 'manifest.txt')

  Write-Host "[mongo8-migration] Backup completado: $TargetDir"
}

function Do-Restore {
  param([string]$SourceDir)

  if (-not $SourceDir) {
    throw 'Debes indicar la ruta del backup.'
  }

  $ResolvedSource = Resolve-Path $SourceDir
  if (-not (Test-Path (Join-Path $ResolvedSource 'dump'))) {
    throw "No existe dump en: $ResolvedSource"
  }

  Ensure-Mongo8Declared
  $Suffix = Get-Date -Format 'yyyyMMdd-HHmmss'

  Write-Host '[mongo8-migration] Deteniendo stack para restauración controlada'
  Invoke-Compose down

  foreach ($DirName in @('mongodb_data', 'mongodb_config')) {
    $CurrentDir = Join-Path $RootDir ".data\$DirName"
    if (Test-Path $CurrentDir) {
      Move-Item $CurrentDir (Join-Path $RootDir ".data\${DirName}_pre_restore_$Suffix")
    }
    New-Item -ItemType Directory -Force -Path $CurrentDir | Out-Null
  }

  Write-Host '[mongo8-migration] Levantando MongoDB limpio'
  Invoke-Compose up -d mongodb
  Wait-ForMongo

  Invoke-Compose exec -T mongodb sh -lc 'rm -rf /tmp/mongo8-restore && mkdir -p /tmp/mongo8-restore'
  & docker cp (Join-Path $ResolvedSource 'dump') "$(Get-MongoContainerId)`:/tmp/mongo8-restore/dump"

  Write-Host '[mongo8-migration] Restaurando dump en Mongo'
  Invoke-Compose exec -T mongodb sh -lc 'mongorestore --drop --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin" /tmp/mongo8-restore/dump'

  Restore-HostArchive -Archive (Join-Path $ResolvedSource 'uploads.zip') -Suffix $Suffix
  Restore-HostArchive -Archive (Join-Path $ResolvedSource 'tls.zip') -Suffix $Suffix
  Restore-HostArchive -Archive (Join-Path $ResolvedSource 'backups.zip') -Suffix $Suffix

  $EnvBackup = Join-Path $ResolvedSource '.env.backup'
  if (Test-Path $EnvBackup) {
    Copy-Item $EnvBackup (Join-Path $RootDir '.env.from-mongo8-backup') -Force
  }

  Write-Host '[mongo8-migration] Levantando stack completo'
  Invoke-Compose up -d --build
  Write-Host '[mongo8-migration] Restore completado'
}

$Action = if ($args.Length -gt 0) { $args[0] } else { '' }
switch ($Action) {
  'backup' { Do-Backup }
  'restore' { Do-Restore -SourceDir $(if ($args.Length -gt 1) { $args[1] } else { '' }) }
  default {
    Show-Usage
    exit 1
  }
}