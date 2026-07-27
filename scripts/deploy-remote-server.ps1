param(
  [Parameter(Mandatory = $true)]
  [string]$ComputerName,
  [string]$RemotePath = "C:\ProERP-Web",
  [int]$Port = 8015,
  [pscredential]$Credential,
  [switch]$NoBuildFrontend
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP ("proerp-remote-" + [Guid]::NewGuid().ToString("N"))
$Stage = Join-Path $TempRoot "stage"
$ZipPath = Join-Path $TempRoot "proerp-update.zip"
$RemoteSession = $null

function Run-Step($Title, [scriptblock]$Action) {
  Write-Host $Title -ForegroundColor Cyan
  & $Action
}

try {
  Run-Step "[0/5] Testing remote connection..." {
    $sessionArgs = @{ ComputerName = $ComputerName }
    if ($Credential) { $sessionArgs.Credential = $Credential }
    $testSession = New-PSSession @sessionArgs
    Remove-PSSession $testSession
  }

  if (-not $NoBuildFrontend) {
    Run-Step "[1/5] Building frontend..." {
      Push-Location (Join-Path $Root "frontend")
      npm run build
      Pop-Location
    }
  } else {
    Write-Host "[1/5] Skipping frontend build." -ForegroundColor Yellow
  }

  Run-Step "[2/5] Creating update package..." {
    New-Item -ItemType Directory -Force -Path $Stage | Out-Null

    $excludeDirs = @(
      ".git", ".firebase", ".venv", "logs",
      "backend\venv", "backend\__pycache__",
      "frontend\node_modules"
    )
    $excludeFiles = @(
      "backend\.env", "frontend\.env",
      "backend\proerp.db", "backend\proerp.db-shm", "backend\proerp.db-wal",
      "firebase-debug.log"
    )

    $robocopyArgs = @($Root, $Stage, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    if ($excludeDirs.Count) { $robocopyArgs += "/XD"; $robocopyArgs += $excludeDirs }
    if ($excludeFiles.Count) { $robocopyArgs += "/XF"; $robocopyArgs += $excludeFiles }

    & "$env:SystemRoot\System32\robocopy.exe" @robocopyArgs | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "Robocopy failed with exit code $LASTEXITCODE"
    }

    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
  }

  Run-Step "[3/5] Connecting to remote computer..." {
    $sessionArgs = @{ ComputerName = $ComputerName }
    if ($Credential) { $sessionArgs.Credential = $Credential }
    $script:RemoteSession = New-PSSession @sessionArgs
  }

  try {
    Run-Step "[4/5] Copying package to remote computer..." {
      $remoteZip = "C:\Windows\Temp\proerp-update.zip"
      Copy-Item -Path $ZipPath -Destination $remoteZip -ToSession $script:RemoteSession -Force
    }

    Run-Step "[5/5] Installing update and restarting remote backend..." {
      Invoke-Command -Session $script:RemoteSession -ArgumentList $RemotePath, $Port -ScriptBlock {
        param($RemotePath, $Port)
        $ErrorActionPreference = "Stop"

        $remoteZip = "C:\Windows\Temp\proerp-update.zip"
        New-Item -ItemType Directory -Force -Path $RemotePath | Out-Null
        Expand-Archive -Path $remoteZip -DestinationPath $RemotePath -Force

        $backend = Join-Path $RemotePath "backend"
        $python = Join-Path $backend "venv\Scripts\python.exe"
        if (-not (Test-Path $python)) {
          $venvPath = Join-Path $backend "venv"
          $pythonCandidates = @()

          $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
          if ($pythonCmd) { $pythonCandidates += @($pythonCmd.Source, "-m", "venv", $venvPath) }

          $pyCmd = Get-Command py -ErrorAction SilentlyContinue
          if ($pyCmd) { $pythonCandidates += @($pyCmd.Source, "-3", "-m", "venv", $venvPath) }

          $createdVenv = $false
          for ($i = 0; $i -lt $pythonCandidates.Count; $i += 4) {
            $exe = $pythonCandidates[$i]
            $args = @($pythonCandidates[$i + 1], $pythonCandidates[$i + 2], $pythonCandidates[$i + 3])
            try {
              & $exe @args
              if ($LASTEXITCODE -eq 0 -and (Test-Path $python)) {
                $createdVenv = $true
                break
              }
            } catch {
              Write-Host "Python candidate failed: $exe $($args -join ' ')" -ForegroundColor DarkYellow
            }
          }

          if (-not $createdVenv) {
            throw "Python 3 is not correctly installed on the remote computer. Install Python 3 and check 'Add python.exe to PATH', then retry."
          }
        }

        if (-not (Test-Path (Join-Path $backend ".env"))) {
          $secret = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
          @"
SECRET_KEY=$secret
ACCESS_TOKEN_EXPIRE_HOURS=12
DATABASE_URL=sqlite:///./proerp.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
"@ | Set-Content -Path (Join-Path $backend ".env") -Encoding UTF8
        }

        & $python -m pip install --upgrade pip
        & $python -m pip install -r (Join-Path $backend "requirements.txt")

        $listeners = & "$env:SystemRoot\System32\netstat.exe" -ano | Select-String ":$Port"
        foreach ($line in $listeners) {
          $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
          if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
            & "$env:SystemRoot\System32\taskkill.exe" /PID $parts[4] /F | Out-Null
          }
        }

        Start-Process `
          -FilePath $python `
          -ArgumentList @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$Port") `
          -WorkingDirectory $backend `
          -WindowStyle Hidden

        Start-Sleep -Seconds 4
        $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 10
        if ($health.StatusCode -ne 200) {
          throw "Remote backend health check failed"
        }
        Write-Host "Remote backend is running: http://127.0.0.1:$Port"
      }
    }
  } finally {
    if ($script:RemoteSession) {
      Remove-PSSession $script:RemoteSession
      $script:RemoteSession = $null
    }
  }

  Write-Host ""
  Write-Host "Remote deployment complete." -ForegroundColor Green
  Write-Host "Open the app on the remote network with: http://$ComputerName`:$Port" -ForegroundColor Cyan
  Write-Host "The remote database was preserved in: $RemotePath\backend\proerp.db" -ForegroundColor Green
} finally {
  try {
    if (Test-Path -LiteralPath $TempRoot) {
      Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction Stop
    }
  } catch {
    Write-Host "Temporary cleanup skipped: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}
