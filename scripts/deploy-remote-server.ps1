[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ComputerName,
  [string]$RemotePath = "C:\ProERP-Web",
  [ValidateRange(1, 65535)]
  [int]$Port = 8015,
  [pscredential]$Credential,
  [switch]$NoBuildFrontend,
  [string]$BrowserUser = "",
  [string]$InitialAdminPassword = "",
  [switch]$NoBrowserTask
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP ("library-sabri-remote-" + [Guid]::NewGuid().ToString("N"))
$Stage = Join-Path $TempRoot "stage"
$ZipPath = Join-Path $TempRoot "library-sabri-update.zip"
$RemoteZip = "C:\Windows\Temp\library-sabri-update-$([Guid]::NewGuid().ToString('N')).zip"
$RemoteSession = $null

function Run-Step([string]$Title, [scriptblock]$Action) {
  Write-Host $Title -ForegroundColor Cyan
  & $Action
}

function Assert-SafeTemporaryPath([string]$Path) {
  $FullPath = [IO.Path]::GetFullPath($Path)
  $TempPrefix = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  if (-not $FullPath.StartsWith($TempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a temporary path outside TEMP: $FullPath"
  }
}

Assert-SafeTemporaryPath $TempRoot

try {
  Run-Step "[1/6] Connecting to the other computer..." {
    $SessionArgs = @{ ComputerName = $ComputerName }
    if ($Credential) { $SessionArgs.Credential = $Credential }
    $script:RemoteSession = New-PSSession @SessionArgs
  }

  if (-not $NoBuildFrontend) {
    Run-Step "[2/6] Building the frontend..." {
      Push-Location (Join-Path $Root "frontend")
      try {
        $PreviousApiBase = $env:VITE_API_BASE_URL
        $env:VITE_API_BASE_URL = "/api"
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed."
        }
      } finally {
        if ($null -eq $PreviousApiBase) {
          Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
        } else {
          $env:VITE_API_BASE_URL = $PreviousApiBase
        }
        Pop-Location
      }
    }
  } else {
    Write-Host "[2/6] Frontend build skipped by request." -ForegroundColor Yellow
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Root "frontend\dist\index.html") -PathType Leaf)) {
    throw "frontend\dist is missing. Build the frontend before remote deployment."
  }

  Run-Step "[3/6] Creating a data-free update package..." {
    New-Item -ItemType Directory -Force -Path $Stage | Out-Null

    # Runtime data must always come from the other computer. Robocopy does not
    # honour .gitignore, so every protected directory is excluded explicitly.
    $ExcludeDirs = @(
      (Join-Path $Root ".git"),
      (Join-Path $Root ".firebase"),
      (Join-Path $Root ".venv"),
      (Join-Path $Root ".runtime"),
      (Join-Path $Root "logs"),
      (Join-Path $Root "uploads"),
      (Join-Path $Root "backend\venv"),
      (Join-Path $Root "backend\__pycache__"),
      (Join-Path $Root "backend\uploads"),
      (Join-Path $Root "backend\data"),
      (Join-Path $Root "backend\backups"),
      (Join-Path $Root "frontend\node_modules")
    )
    $ExcludeFiles = @(
      (Join-Path $Root ".env"),
      (Join-Path $Root "backend\.env"),
      (Join-Path $Root "frontend\.env"),
      (Join-Path $Root "backend\company_settings.json"),
      (Join-Path $Root "backend\proerp.db"),
      (Join-Path $Root "backend\proerp.db-shm"),
      (Join-Path $Root "backend\proerp.db-wal"),
      (Join-Path $Root "firebase-debug.log")
    )

    $RobocopyArgs = @($Root, $Stage, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1")
    $RobocopyArgs += "/XD"
    $RobocopyArgs += $ExcludeDirs
    $RobocopyArgs += "/XF"
    $RobocopyArgs += $ExcludeFiles
    & "$env:SystemRoot\System32\robocopy.exe" @RobocopyArgs | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Robocopy failed with exit code $LASTEXITCODE."
    }

    $RuntimeJson = [ordered]@{
      api_base_url = "/api"
      maintenance_mode = $false
      app_version = "1.0.0"
    } | ConvertTo-Json
    foreach ($RelativeConfig in @("frontend\public\runtime-config.json", "frontend\dist\runtime-config.json")) {
      $ConfigPath = Join-Path $Stage $RelativeConfig
      $ConfigParent = Split-Path -Parent $ConfigPath
      if (Test-Path -LiteralPath $ConfigParent -PathType Container) {
        [IO.File]::WriteAllText($ConfigPath, $RuntimeJson, [Text.UTF8Encoding]::new($false))
      }
    }

    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
  }

  Run-Step "[4/6] Uploading the update package..." {
    Copy-Item -LiteralPath $ZipPath -Destination $RemoteZip -ToSession $script:RemoteSession -Force
  }

  Run-Step "[5/6] Backing up, updating, and verifying the other computer..." {
    $Result = Invoke-Command `
      -Session $script:RemoteSession `
      -ArgumentList $RemotePath, $Port, $RemoteZip, $BrowserUser, $InitialAdminPassword, ([bool]$NoBrowserTask) `
      -ScriptBlock {
      param(
        [string]$RemotePath,
        [int]$Port,
        [string]$RemoteZip,
        [string]$BrowserUser,
        [string]$InitialAdminPassword,
        [bool]$NoBrowserTask
      )

      $ErrorActionPreference = "Stop"
      $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $RemotePath = [IO.Path]::GetFullPath($RemotePath).TrimEnd('\')
      $RemoteParent = Split-Path -Parent $RemotePath
      if ([string]::IsNullOrWhiteSpace($RemoteParent) -or $RemotePath -match "^[A-Za-z]:$") {
        throw "RemotePath must be a dedicated application folder, not a drive root."
      }

      $StagingPath = "$RemotePath.update-$Stamp"
      $PreviousPath = "$RemotePath.previous-$Stamp"
      $FailedPath = "$RemotePath.failed-$Stamp"
      $BackupRoot = Join-Path $env:ProgramData "LibrarySabri\upgrade-backups"
      $BackupDir = Join-Path $BackupRoot $Stamp
      $DatabaseBackup = Join-Path $BackupDir "backend\proerp.db"
      $BeforeSnapshot = Join-Path $BackupDir "before.json"
      $OldExisted = Test-Path -LiteralPath $RemotePath -PathType Container
      $OldMoved = $false
      $Promoted = $false

      function Write-Remote([string]$Message) {
        Write-Host "[REMOTE] $Message" -ForegroundColor DarkCyan
      }

      function Assert-ChildPath([string]$Path) {
        $Full = [IO.Path]::GetFullPath($Path)
        $Prefix = [IO.Path]::GetFullPath($RemoteParent).TrimEnd('\') + '\'
        if (-not $Full.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
          throw "Unsafe deployment path: $Full"
        }
      }

      function Assert-BackupPath([string]$Path) {
        $Full = [IO.Path]::GetFullPath($Path)
        $Prefix = [IO.Path]::GetFullPath($BackupRoot).TrimEnd('\') + '\'
        if (-not $Full.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
          throw "Unsafe backup path: $Full"
        }
      }

      function Get-PythonSpec([string]$ApplicationRoot, [switch]$GlobalOnly) {
        if (-not $GlobalOnly) {
          foreach ($Candidate in @(
            (Join-Path $ApplicationRoot "backend\venv\Scripts\python.exe"),
            (Join-Path $ApplicationRoot ".venv\Scripts\python.exe")
          )) {
            if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
              return [pscustomobject]@{ Exe = $Candidate; Prefix = @() }
            }
          }
        }
        $PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
        if (-not $PythonCommand) { $PythonCommand = Get-Command python -ErrorAction SilentlyContinue }
        if ($PythonCommand) {
          return [pscustomobject]@{ Exe = $PythonCommand.Source; Prefix = @() }
        }
        $PyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if (-not $PyCommand) { $PyCommand = Get-Command py -ErrorAction SilentlyContinue }
        if ($PyCommand) {
          return [pscustomobject]@{ Exe = $PyCommand.Source; Prefix = @("-3") }
        }
        return $null
      }

      function Invoke-PythonChecked($PythonSpec, [string[]]$Arguments, [string]$FailureMessage) {
        $AllArguments = @($PythonSpec.Prefix) + $Arguments
        & $PythonSpec.Exe @AllArguments
        if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
      }

      function Stop-PidFile([string]$PidFile, [string]$RequiredCommandText) {
        if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) { return }
        try {
          $ProcessId = [int]([IO.File]::ReadAllText($PidFile).Trim())
          $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
          if ($ProcessInfo -and ([string]$ProcessInfo.CommandLine) -like "*$RequiredCommandText*") {
            Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
          }
        } finally {
          Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
      }

      function Stop-LibrarySabri {
        foreach ($Task in @("LibrarySabri-OpenChrome", "LibrarySabri-Server", "ProERP LAN Server", "LibrarySabri")) {
          Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
        }
        $Runtime = Join-Path $RemotePath ".runtime"
        Stop-PidFile (Join-Path $Runtime "lan-watchdog.pid") "server-watchdog.ps1"
        Stop-PidFile (Join-Path $Runtime "lan-server.pid") "uvicorn"

        $ListeningIds = @()
        if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
          $ListeningIds = @(
            Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty OwningProcess -Unique
          )
        }
        foreach ($ProcessId in $ListeningIds) {
          $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
          $CommandLine = [string]$ProcessInfo.CommandLine
          $Executable = [string]$ProcessInfo.ExecutablePath
          $Owned = $ProcessInfo -and $CommandLine -match "(?i)\buvicorn\b" -and $CommandLine -match "main:app"
          if ($Owned -and $Executable) {
            $Owned = [IO.Path]::GetFullPath($Executable).StartsWith(
              ($RemotePath + '\'),
              [StringComparison]::OrdinalIgnoreCase
            )
          }
          if (-not $Owned) {
            throw "TCP port $Port belongs to another program (PID $ProcessId); update stopped safely."
          }
          Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        }
        for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
          $StillListening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
          if (-not $StillListening) { return }
          Start-Sleep -Milliseconds 250
        }
        throw "The old server did not stop cleanly."
      }

      function Copy-PreservedItem([string]$RelativePath, [string]$SourceRoot, [string]$DestinationRoot) {
        $Source = Join-Path $SourceRoot $RelativePath
        if (-not (Test-Path -LiteralPath $Source)) { return }
        $Destination = Join-Path $DestinationRoot $RelativePath
        $DestinationParent = Split-Path -Parent $Destination
        New-Item -ItemType Directory -Force -Path $DestinationParent | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
      }

      function Install-Startup([string]$ApplicationRoot) {
        $Installer = Join-Path $ApplicationRoot "scripts\install-lan-erp-startup.ps1"
        if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
          throw "Startup installer is missing from the deployed version."
        }
        $Parameters = @{ Port = $Port; OpenFirewall = $true; NoImmediateOpen = $true }
        if ($BrowserUser) { $Parameters.BrowserUser = $BrowserUser }
        if ($NoBrowserTask) { $Parameters.NoBrowserTask = $true }
        & $Installer @Parameters
        if ($LASTEXITCODE -ne 0) { throw "Automatic startup installation failed."
        }
      }

      foreach ($PathToCheck in @($StagingPath, $PreviousPath, $FailedPath)) { Assert-ChildPath $PathToCheck }
      Assert-BackupPath $BackupDir

      try {
        New-Item -ItemType Directory -Force -Path $RemoteParent, $BackupDir | Out-Null
        if (Test-Path -LiteralPath $StagingPath) {
          throw "Unexpected staging folder already exists: $StagingPath"
        }
        New-Item -ItemType Directory -Path $StagingPath | Out-Null
        Expand-Archive -LiteralPath $RemoteZip -DestinationPath $StagingPath -Force

        $Guard = Join-Path $StagingPath "scripts\upgrade_data_guard.py"
        if (-not (Test-Path -LiteralPath $Guard -PathType Leaf)) {
          throw "The update data guard is missing."
        }

        $OldDatabase = Join-Path $RemotePath "backend\proerp.db"
        if ($OldExisted) {
          Stop-LibrarySabri
          if (-not (Test-Path -LiteralPath $OldDatabase -PathType Leaf)) {
            throw "Existing database not found: $OldDatabase"
          }

          Write-Remote "Creating a consistent SQLite backup (including committed WAL data)..."
          $OldPython = Get-PythonSpec $RemotePath
          if (-not $OldPython) { throw "Python is required to back up the existing SQLite database."
          }
          New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DatabaseBackup) | Out-Null
          Invoke-PythonChecked $OldPython @($Guard, "snapshot", "--database", $OldDatabase, "--output", $BeforeSnapshot) "Pre-update database integrity check failed."
          Invoke-PythonChecked $OldPython @($Guard, "backup", "--database", $OldDatabase, "--output", $DatabaseBackup) "Consistent SQLite backup failed."

          foreach ($Item in @(
            "backend\.env",
            "backend\company_settings.json",
            "backend\uploads",
            "backend\data",
            "backend\backups",
            "uploads"
          )) {
            Copy-PreservedItem $Item $RemotePath $BackupDir
          }
        } elseif ([string]::IsNullOrWhiteSpace($InitialAdminPassword)) {
          throw "No existing database was found. InitialAdminPassword is required for a new server installation."
        }

        if ($OldExisted) {
          Move-Item -LiteralPath $RemotePath -Destination $PreviousPath
          $OldMoved = $true
        }
        Move-Item -LiteralPath $StagingPath -Destination $RemotePath
        $Promoted = $true
        $Guard = Join-Path $RemotePath "scripts\upgrade_data_guard.py"

        if ($OldExisted) {
          Copy-Item -LiteralPath $DatabaseBackup -Destination (Join-Path $RemotePath "backend\proerp.db") -Force
          foreach ($Item in @(
            "backend\.env",
            "backend\company_settings.json",
            "backend\uploads",
            "backend\data",
            "backend\backups",
            "uploads"
          )) {
            Copy-PreservedItem $Item $BackupDir $RemotePath
          }
        }

        $EnvironmentFile = Join-Path $RemotePath "backend\.env"
        if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
          if ($InitialAdminPassword -match "[\r\n]") { throw "InitialAdminPassword contains an invalid newline."
          }
          $Secret = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
          $EnvironmentText = @(
            "APP_ENV=development",
            "SECRET_KEY=$Secret",
            "INITIAL_ADMIN_PASSWORD=$InitialAdminPassword",
            "COOKIE_SECURE=false",
            "COOKIE_SAMESITE=strict",
            "TRUST_PROXY_HEADERS=false",
            "DATABASE_URL=sqlite:///./proerp.db",
            "CORS_ORIGINS=http://localhost:$Port,http://127.0.0.1:$Port"
          ) -join "`r`n"
          [IO.File]::WriteAllText($EnvironmentFile, $EnvironmentText, [Text.UTF8Encoding]::new($false))
        }

        Write-Remote "Creating the isolated Python environment..."
        $GlobalPython = Get-PythonSpec $RemotePath -GlobalOnly
        if (-not $GlobalPython) { throw "Python 3 is not installed on the other computer."
        }
        $VenvPath = Join-Path $RemotePath "backend\venv"
        Invoke-PythonChecked $GlobalPython @("-m", "venv", $VenvPath) "Python virtual environment creation failed."
        $NewPython = [pscustomobject]@{ Exe = (Join-Path $VenvPath "Scripts\python.exe"); Prefix = @() }
        Invoke-PythonChecked $NewPython @("-m", "pip", "install", "--disable-pip-version-check", "--quiet", "-r", (Join-Path $RemotePath "backend\requirements.txt")) "Python dependency installation failed."

        Write-Remote "Applying additive schema updates..."
        Push-Location (Join-Path $RemotePath "backend")
        try {
          Invoke-PythonChecked $NewPython @("-c", "from core.database import init_db; init_db(); print('DATABASE_UPGRADE_OK')") "Database migration failed."
        } finally {
          Pop-Location
        }

        $NewDatabase = Join-Path $RemotePath "backend\proerp.db"
        if ($OldExisted) {
          Invoke-PythonChecked $NewPython @($Guard, "verify", "--database", $NewDatabase, "--before", $BeforeSnapshot) "Post-update data verification failed."
        } else {
          Invoke-PythonChecked $NewPython @($Guard, "snapshot", "--database", $NewDatabase) "New database integrity check failed."
        }

        Write-Remote "Installing the Windows startup watchdog and LAN firewall rule..."
        Install-Startup $RemotePath

        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10
        if ($Health.status -ne "ok") { throw "Remote health check returned an invalid response."
        }
        $Page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 10
        if ($Page.StatusCode -ne 200) { throw "The built application page is unavailable."
        }
        if ($OldExisted) {
          Invoke-PythonChecked $NewPython @($Guard, "verify", "--database", $NewDatabase, "--before", $BeforeSnapshot) "Running database verification failed."
        }

        [pscustomobject]@{
          Status = "ok"
          Version = [string]$Health.version
          Url = "http://$env:COMPUTERNAME`:$Port/"
          Backup = $BackupDir
          PreviousVersion = if ($OldMoved) { $PreviousPath } else { "" }
          Database = $NewDatabase
        }
      } catch {
        $FailureMessage = $_.Exception.Message
        Write-Remote "Update failed; automatic rollback started: $FailureMessage"
        try { Stop-LibrarySabri } catch {}
        foreach ($Task in @("LibrarySabri-OpenChrome", "LibrarySabri-Server")) {
          Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
          Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
        }

        if ($Promoted -and (Test-Path -LiteralPath $RemotePath)) {
          Move-Item -LiteralPath $RemotePath -Destination $FailedPath -ErrorAction SilentlyContinue
        }
        if ($OldMoved -and (Test-Path -LiteralPath $PreviousPath)) {
          Move-Item -LiteralPath $PreviousPath -Destination $RemotePath
        }
        if ($OldExisted -and (Test-Path -LiteralPath $RemotePath)) {
          try {
            $OldInstaller = Join-Path $RemotePath "scripts\install-lan-erp-startup.ps1"
            if (Test-Path -LiteralPath $OldInstaller) {
              $InstallerCommand = Get-Command $OldInstaller -ErrorAction SilentlyContinue
              if ($InstallerCommand.Parameters.ContainsKey("BrowserTaskName")) {
                & $OldInstaller -Port $Port -OpenFirewall -NoImmediateOpen
              } else {
                & $OldInstaller -Port $Port -OpenFirewall
              }
            } else {
              $OldStart = Join-Path $RemotePath "scripts\start-lan-erp.ps1"
              if (Test-Path -LiteralPath $OldStart) { & $OldStart -Port $Port -NoBuild -OpenFirewall }
            }
          } catch {
            Write-Warning "Old version/data are present but could not be restarted automatically: $($_.Exception.Message)"
          }
        }
        throw "Remote update cancelled. Previous application/data restored when available. Cause: $FailureMessage. Safety backup: $BackupDir"
      } finally {
        Remove-Item -LiteralPath $RemoteZip -Force -ErrorAction SilentlyContinue
      }
    }

    $Result | Format-List | Out-Host
    $script:DeploymentResult = $Result
  }

  Run-Step "[6/6] Remote update completed successfully." {
    $OpenUrl = "http://$ComputerName`:$Port/"
    Write-Host "Application: $OpenUrl" -ForegroundColor Green
    Write-Host "Database preserved: $($script:DeploymentResult.Database)" -ForegroundColor Green
    Write-Host "Safety backup: $($script:DeploymentResult.Backup)" -ForegroundColor Yellow
    if ($script:DeploymentResult.PreviousVersion) {
      Write-Host "Previous code retained for rollback: $($script:DeploymentResult.PreviousVersion)" -ForegroundColor Gray
    }
    if (-not $NoBrowserTask) {
      Write-Host "Chrome will open automatically after the configured Windows user logs on." -ForegroundColor Cyan
    }
  }
} finally {
  if ($RemoteSession) {
    Remove-PSSession $RemoteSession -ErrorAction SilentlyContinue
    $RemoteSession = $null
  }
  if (Test-Path -LiteralPath $TempRoot) {
    Assert-SafeTemporaryPath $TempRoot
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
