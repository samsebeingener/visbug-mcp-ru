# Local VisBug MCP WebSocket daemon (127.0.0.1:4844 only)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# Перезапуск: убить старый процесс на порту 4844 (иначе останется старый parser.js в памяти)
$conns = Get-NetTCPConnection -LocalPort 4844 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList "src/ws-daemon.js" -WorkingDirectory $Root -WindowStyle Hidden
Write-Host "visbug-ws restarted on ws://127.0.0.1:4844. Reload extension at chrome://extensions"
