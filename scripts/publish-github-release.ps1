param(
  [string]$Owner = "graxytv",
  [string]$Repo = "soe-holy-grail",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

function Resolve-Tool($Name, $CandidatePaths, $InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  Refresh-Path
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($candidate in $CandidatePaths) {
    if (Test-Path -LiteralPath $candidate) {
      $candidateDir = Split-Path -Parent $candidate
      if (($env:Path -split ";") -notcontains $candidateDir) {
        $env:Path = "$candidateDir;$env:Path"
      }
      return $candidate
    }
  }

  throw "$Name is required. $InstallHint"
}

function Invoke-Quiet($CommandPath, [string[]]$Arguments) {
  $oldErrorActionPreference = $ErrorActionPreference
  $nativePreferenceExists = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue
  if ($nativePreferenceExists) {
    $oldNativePreference = $global:PSNativeCommandUseErrorActionPreference
  }

  try {
    $ErrorActionPreference = "Continue"
    if ($nativePreferenceExists) {
      $global:PSNativeCommandUseErrorActionPreference = $false
    }
    & $CommandPath @Arguments *> $null
    return $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $oldErrorActionPreference
    if ($nativePreferenceExists) {
      $global:PSNativeCommandUseErrorActionPreference = $oldNativePreference
    }
  }
}

$Git = Resolve-Tool "git" @(
  "$env:ProgramFiles\Git\cmd\git.exe",
  "$env:ProgramFiles\Git\bin\git.exe",
  "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
  "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
) "Install Git for Windows, then open a new terminal."

$Gh = Resolve-Tool "gh" @(
  "$env:ProgramFiles\GitHub CLI\gh.exe",
  "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
  "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
) "Install GitHub CLI, then run: gh auth login"

$authStatus = Invoke-Quiet $Gh @("auth", "status")
if ($authStatus -ne 0) {
  Write-Host "GitHub CLI is installed, but it is not authenticated yet."
  Write-Host "Run this once:"
  Write-Host "  `"$Gh`" auth login"
  Write-Host ""
  Write-Host "After login finishes, rerun this publish script."
  exit 1
}

$ProjectDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$RootDir = Split-Path -Parent $ProjectDir
$PackageJson = Get-Content -LiteralPath (Join-Path $ProjectDir "package.json") -Raw | ConvertFrom-Json
$Version = $PackageJson.version
$Tag = "v$Version"
$RepoFullName = "$Owner/$Repo"
$RuntimeAsset = Join-Path $ProjectDir "dist\SoE-Holy-Grail-win32-x64-v$Version.zip"
$ChecksumFile = Join-Path $ProjectDir "RELEASE_CHECKSUMS_v$Version.txt"
$ReleaseNotes = Join-Path $ProjectDir "RELEASE_NOTES_v$Version.md"
$SourceAsset = Get-ChildItem -LiteralPath $RootDir -Filter "SoE-Holy-Grail-source-*.zip" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

foreach ($requiredFile in @($RuntimeAsset, $ChecksumFile, $ReleaseNotes)) {
  if (!(Test-Path -LiteralPath $requiredFile)) {
    throw "Missing required release file: $requiredFile"
  }
}

if (!$SourceAsset) {
  throw "Missing source zip in $RootDir"
}

Push-Location $ProjectDir
try {
  if (!(Test-Path -LiteralPath ".git")) {
    & $Git init
    & $Git branch -M main
  }

  $tracked = @(
    ".gitignore",
    "assets",
    "data",
    "docs",
    "scripts",
    "src",
    "package.json",
    "README.md"
  )
  $tracked += Get-ChildItem -LiteralPath $ProjectDir -Filter "RELEASE_CHECKSUMS_*.txt" | ForEach-Object { $_.Name }
  $tracked += Get-ChildItem -LiteralPath $ProjectDir -Filter "RELEASE_NOTES_*.md" | ForEach-Object { $_.Name }

  & $Git add -- $tracked
  $cachedDiffStatus = Invoke-Quiet $Git @("diff", "--cached", "--quiet")
  if ($cachedDiffStatus -ne 0) {
    & $Git commit -m "Release SoE Holy Grail $Tag"
  }

  $repoExists = (Invoke-Quiet $Gh @("repo", "view", $RepoFullName)) -eq 0

  if (!$repoExists) {
    & $Gh repo create $RepoFullName "--$Visibility" --description "Sanctuary of Exile holy grail tracker" --source $ProjectDir --remote origin --push
  } else {
    $originUrl = "https://github.com/$RepoFullName.git"
    $originExists = (Invoke-Quiet $Git @("remote", "get-url", "origin")) -eq 0
    if ($originExists) {
      & $Git remote set-url origin $originUrl
    } else {
      & $Git remote add origin $originUrl
    }

    $branch = & $Git branch --show-current
    & $Git push -u origin $branch
  }

  $tagExists = (Invoke-Quiet $Git @("rev-parse", $Tag)) -eq 0
  if (!$tagExists) {
    & $Git tag -a $Tag -m "SoE Holy Grail $Tag"
  }
  & $Git push origin $Tag

  $releaseExists = (Invoke-Quiet $Gh @("release", "view", $Tag, "--repo", $RepoFullName)) -eq 0
  if ($releaseExists) {
    & $Gh release upload $Tag $RuntimeAsset $SourceAsset.FullName $ChecksumFile --repo $RepoFullName --clobber
  } else {
    & $Gh release create $Tag $RuntimeAsset $SourceAsset.FullName $ChecksumFile --repo $RepoFullName --title "SoE Holy Grail $Tag" --notes-file $ReleaseNotes
  }

  Write-Output "Published https://github.com/$RepoFullName/releases/tag/$Tag"
}
finally {
  Pop-Location
}
