param(
  [string]$RuntimeDir = "..\SoE Holy Grail Runtime",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$RuntimePath = Resolve-Path -LiteralPath (Join-Path $ProjectDir $RuntimeDir)
$PackageJson = Get-Content -LiteralPath (Join-Path $ProjectDir "package.json") -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $PackageJson.version
}

if (!(Test-Path -LiteralPath (Join-Path $RuntimePath "SoE Holy Grail.exe"))) {
  throw "Runtime folder must contain SoE Holy Grail.exe: $RuntimePath"
}

if (!(Test-Path -LiteralPath (Join-Path $RuntimePath "resources\app\package.json"))) {
  throw "Runtime folder must contain resources\app\package.json: $RuntimePath"
}

$DistDir = Join-Path $ProjectDir "dist"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$ZipPath = Join-Path $DistDir "SoE-Holy-Grail-win32-x64-v$Version.zip"
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Compress-Archive -Path (Join-Path $RuntimePath "*") -DestinationPath $ZipPath -Force
Write-Output $ZipPath
