param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtime=Get-Content -LiteralPath (Join-Path $sourceRoot 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$destinationRoot=[System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
$archive=Join-Path (Split-Path -Parent $destinationRoot) $runtime.archive
if(-not (Test-Path -LiteralPath $archive)){
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 if(Get-Command curl.exe -ErrorAction SilentlyContinue){& curl.exe --location --fail --silent --show-error --retry 2 --output $archive $runtime.url;if($LASTEXITCODE -ne 0){throw 'Runtime download failed'}}else{Invoke-WebRequest -Uri $runtime.url -OutFile $archive -UseBasicParsing}
}
$hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if($hash -ne $runtime.sha256){throw ('Runtime checksum mismatch. Remove only this archive and retry: '+$archive)}
Expand-Archive -LiteralPath $archive -DestinationPath $destinationRoot -Force
Write-Output $destinationRoot
