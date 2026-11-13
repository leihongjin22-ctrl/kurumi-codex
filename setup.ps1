param([string]$InstallDirectory,[switch]$NoLaunch,[switch]$NoShortcut)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$packagedExe=Join-Path (Split-Path -Parent (Split-Path -Parent $sourceRoot)) 'Kurumi Codex.exe'
if(-not $InstallDirectory){if(Test-Path -LiteralPath $packagedExe){$InstallDirectory=$sourceRoot}else{$InstallDirectory=Join-Path $env:LOCALAPPDATA 'KurumiCodex\client'}}
$installRoot=[IO.Path]::GetFullPath($InstallDirectory)
if($installRoot -ne [IO.Path]::GetFullPath($sourceRoot)){
 New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
 $manifest=Get-Content -LiteralPath (Join-Path $sourceRoot 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 foreach($name in @($manifest.files)+@($manifest.directories)){
  $sourcePath=[IO.Path]::GetFullPath((Join-Path $sourceRoot $name));$targetPath=[IO.Path]::GetFullPath((Join-Path $installRoot $name))
  if(-not $sourcePath.StartsWith($sourceRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $targetPath.StartsWith($installRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid release manifest path'}
  if(Test-Path -LiteralPath $sourcePath -PathType Container){New-Item -ItemType Directory -Path $targetPath -Force | Out-Null;Get-ChildItem -LiteralPath $sourcePath -Force | Copy-Item -Destination $targetPath -Recurse -Force}else{Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force}
 }
 Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs-public\README.md') -Destination (Join-Path $installRoot 'README.md') -Force
}
$installedPortableExe=Join-Path (Split-Path -Parent (Split-Path -Parent $installRoot)) 'Kurumi Codex.exe'
if(-not (Test-Path -LiteralPath $installedPortableExe)){
 $runtimePath=Join-Path $env:LOCALAPPDATA 'KurumiCodex\runtime'
 $pinned=Get-Content -LiteralPath (Join-Path $installRoot 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $installedVersion=if(Test-Path -LiteralPath (Join-Path $runtimePath 'version')){(Get-Content -LiteralPath (Join-Path $runtimePath 'version') -Raw -Encoding UTF8).Trim()}else{''}
 if(-not (Test-Path -LiteralPath (Join-Path $runtimePath 'electron.exe')) -or $installedVersion -ne $pinned.version){& (Join-Path $installRoot 'scripts\fetch-runtime.ps1') -Destination $runtimePath | Out-Null}
}
if(-not $NoShortcut){& (Join-Path $installRoot 'install-shortcuts.ps1')}
Write-Output ('Installed at '+$installRoot)
if(-not $NoLaunch){& (Join-Path $installRoot 'launch-client.ps1')}
