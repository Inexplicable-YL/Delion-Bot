# Dot-source this script: . ./scripts/use-local-tools.ps1
$delionRoot = Split-Path -Parent $PSScriptRoot
$delionNodeVersion = (Get-Content -LiteralPath (Join-Path $delionRoot '.node-version') -Raw).Trim()
$delionPackageManager = (Get-Content -LiteralPath (Join-Path $delionRoot 'package.json') -Raw | ConvertFrom-Json).packageManager
$delionNodeDir = Join-Path $delionRoot ".tools/node-v$delionNodeVersion-win-x64"
$delionPnpmDir = Join-Path $delionRoot '.tools/package-manager/node_modules/@pnpm/exe.win32-x64'
if (!(Test-Path (Join-Path $delionNodeDir 'node.exe')) -or !(Test-Path (Join-Path $delionPnpmDir 'pnpm.exe'))) {
  throw "Local tools are missing. Install Node.js $delionNodeVersion and $delionPackageManager or follow README.md."
}
$env:PATH = "$delionNodeDir;$delionPnpmDir;" + $env:PATH
