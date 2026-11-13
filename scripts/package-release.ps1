param([string]$RuntimeZip,[string]$NodeExecutable='node')
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$package=Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest=Get-Content -LiteralPath (Join-Path $sourceRoot 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime=Get-Content -LiteralPath (Join-Path $sourceRoot 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version=$package.version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version'}
if((Get-Content -LiteralPath (Join-Path $sourceRoot '.codex-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version -ne $version){throw 'Plugin and client versions must match'}
$cache=Join-Path $sourceRoot 'build-cache';$dist=Join-Path $sourceRoot 'dist'
New-Item -ItemType Directory -Path $cache,$dist -Force | Out-Null
if(-not $RuntimeZip){$RuntimeZip=Join-Path $cache $runtime.archive;if(-not(Test-Path -LiteralPath $RuntimeZip)){& (Join-Path $sourceRoot 'scripts\fetch-runtime.ps1') -Destination (Join-Path $cache 'electron-runtime') | Out-Null}}
if((Get-FileHash -LiteralPath $RuntimeZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.sha256){throw 'Electron archive checksum mismatch'}
$staging=Join-Path $cache ('stage-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $staging | Out-Null
function Copy-PublicClient([string]$Destination){
 New-Item -ItemType Directory -Path $Destination -Force | Out-Null
 foreach($name in @($manifest.files)+@($manifest.directories)){
  $source=[IO.Path]::GetFullPath((Join-Path $sourceRoot $name))
  if(-not $source.StartsWith($sourceRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest escaped source root'}
  if(-not (Test-Path -LiteralPath $source)){throw ('Missing release file: '+$name)}
  Copy-Item -LiteralPath $source -Destination $Destination -Recurse -Force
 }
 Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs-public\README.md') -Destination (Join-Path $Destination 'README.md') -Force
 $bom=New-Object Text.UTF8Encoding($true)
 Get-ChildItem -LiteralPath $Destination -Filter '*.ps1' -Recurse -File | ForEach-Object {[IO.File]::WriteAllText($_.FullName,[IO.File]::ReadAllText($_.FullName),$bom)}
}
$sourceBundle=Join-Path $staging 'kurumi-codex';Copy-PublicClient $sourceBundle
$portable=Join-Path $staging ('Kurumi-Codex-'+$version+'-win-x64');New-Item -ItemType Directory -Path $portable | Out-Null
Expand-Archive -LiteralPath $RuntimeZip -DestinationPath $portable -Force
Rename-Item -LiteralPath (Join-Path $portable 'electron.exe') -NewName 'Kurumi Codex.exe'
$appRoot=Join-Path $portable 'resources\app';Copy-PublicClient $appRoot
& $NodeExecutable (Join-Path $sourceBundle 'scripts\audit-public.cjs') $sourceBundle
if($LASTEXITCODE -ne 0){throw 'Source privacy audit failed'}
& $NodeExecutable (Join-Path $appRoot 'scripts\audit-public.cjs') $appRoot
if($LASTEXITCODE -ne 0){throw 'Portable app privacy audit failed'}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs-public\PORTABLE.md') -Destination (Join-Path $portable 'README.md')
@('@echo off','"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0resources\app\setup.ps1"') | Set-Content -LiteralPath (Join-Path $portable 'Setup.cmd') -Encoding ASCII
@('@echo off','"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0resources\app\launch-client.ps1"') | Set-Content -LiteralPath (Join-Path $portable 'Launch.cmd') -Encoding ASCII
$audit=@{version=$version;runtimeVersion=$runtime.version;runtimeSHA256=$runtime.sha256;modelMessages=0;sourceRoot='kurumi-codex';portableRoot=(Split-Path -Leaf $portable)}
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach($entry in @(@{Root=$sourceBundle;Name='Kurumi-Codex-'+$version+'-source-plugin.zip'},@{Root=$portable;Name='Kurumi-Codex-'+$version+'-win-x64.zip'})){
 $zip=Join-Path $dist $entry.Name
 if(Test-Path -LiteralPath $zip){throw ('Release already exists; use a new version or move this specific file first: '+$zip)}
 $archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
 try{Get-ChildItem -LiteralPath $entry.Root -Recurse -Force -File | ForEach-Object {$relative=$_.FullName.Substring((Split-Path -Parent $entry.Root).Length+1).Replace('\','/');[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null}}finally{$archive.Dispose()}
}
$hashes=Get-ChildItem -LiteralPath $dist -Filter ('Kurumi-Codex-'+$version+'-*.zip') -File | ForEach-Object {((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$_.Name}
$hashes | Set-Content -LiteralPath (Join-Path $dist 'SHA256SUMS.txt') -Encoding ASCII
$audit | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dist 'build-info.json') -Encoding UTF8
Write-Output ('Release files: '+$dist)
Write-Output ('Staging for verification: '+$staging)
