# Local VisBug MCP WebSocket daemon (127.0.0.1:4844 only)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# Убить все старые ws-daemon (иначе остаётся код без spawnCli=false)
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*ws-daemon.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$conns = Get-NetTCPConnection -LocalPort 4844 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList "src/ws-daemon.js" -WorkingDirectory $Root -WindowStyle Hidden
$pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
Write-Host "VisBug Bridge v$($pkg.version) restarted. Reload extension."
