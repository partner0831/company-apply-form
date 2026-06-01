# Start the local web UI (static files + /api/apply proxy for CORS).
$ErrorActionPreference = "Stop"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js is required. Install from https://nodejs.org/ or open web\index.html in a browser."
}
Set-Location $PSScriptRoot
& $node.Source (Join-Path $PSScriptRoot "server.mjs")
