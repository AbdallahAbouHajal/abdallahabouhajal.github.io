# scripts/refresh_scopus.ps1  — PowerShell 5.1 compatible
$ErrorActionPreference = "Stop"

# repo root = parent of this script folder
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root      = Split-Path $scriptDir -Parent
Set-Location $root

if (-not $env:SCOPUS_API_KEYS) {
  Write-Host 'SCOPUS_API_KEYS is not set. Run once:  setx SCOPUS_API_KEYS "key1,key2"  then reopen PowerShell.'
  exit 1
}

# pick Python (py or python)
$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if ($pyCmd) { $py = $pyCmd.Source } else {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pyCmd) { $py = $pyCmd.Source } else { Write-Error "Python not found in PATH."; exit 1 }
}

# deps
& $py -m pip install --disable-pip-version-check --quiet requests | Out-Null

# ensure output
New-Item -ItemType Directory -Force -Path "data\scopus" | Out-Null

# fetch (Article + Review + Editorial)
& $py tools\scopus_fetcher.py `
  --authors-file data\authors.csv `
  --details `
  --types "Article,Review,Editorial" `
  --out data\scopus `
  --combined data\scopus\scopus.json

Write-Host "Refreshed: data\scopus\scopus.json"
