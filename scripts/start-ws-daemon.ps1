# Local VisBug MCP WebSocket daemon (127.0.0.1:4844 only)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList "src/ws-daemon.js" -WorkingDirectory $Root -WindowStyle Hidden
Write-Host "Демон visbug-ws запущен (ws://127.0.0.1:4844)"
