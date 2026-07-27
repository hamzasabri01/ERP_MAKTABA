# ProERP Remote Local Server

This setup puts ProERP on another Windows computer while keeping the main SQLite database local on that remote computer.

## Architecture

- Remote computer: runs the backend, serves the frontend, and stores `backend/proerp.db`.
- Your current computer: keeps the source code and pushes updates to the remote computer.
- Phone/tablet on the same Wi-Fi: opens `http://REMOTE-IP:8015`.

This avoids temporary Cloudflare links for local use.

## One-time setup on the remote computer

Open PowerShell as Administrator on the remote computer:

```powershell
Enable-PSRemoting -Force
```

Make sure Python 3 is installed on the remote computer.

If Windows Firewall asks, allow private network access for Python.

## One-time setup on this computer

If both computers are in the same Windows workgroup, run PowerShell as Administrator:

```powershell
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "REMOTE-IP" -Force
```

Replace `REMOTE-IP` with the remote computer IP, for example `192.168.1.50`.

## Deploy or update

From this project folder:

```powershell
.\scripts\deploy-remote-server.ps1 -ComputerName 192.168.1.50 -Credential (Get-Credential)
```

The script:

- builds the frontend,
- copies app code to `C:\ProERP-Web` on the remote computer,
- preserves `backend/proerp.db`, `backend/.env`, and uploads,
- installs backend dependencies,
- restarts the backend on port `8015`.

Open:

```text
http://192.168.1.50:8015
```

On phone, use the same URL while connected to the same Wi-Fi.

## Important

Do not manually delete `C:\ProERP-Web\backend\proerp.db` on the remote computer. That is the main local database.
