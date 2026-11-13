$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher=Join-Path $root 'launch-client.ps1'
$icon=Join-Path $root 'assets\kurumi-codex-icon.ico'
if(-not (Test-Path -LiteralPath $launcher)){throw 'Missing launcher script.'}
if(-not (Test-Path -LiteralPath $icon)){throw 'Missing icon.'}
$desktop=[Environment]::GetFolderPath('Desktop')
$shell=New-Object -ComObject WScript.Shell
$customPath=Join-Path $desktop 'Kurumi Codex.lnk'
$backup=Join-Path $root 'previous-kurumi-shortcut.lnk'
if((Test-Path -LiteralPath $customPath) -and -not (Test-Path -LiteralPath $backup)){Copy-Item -LiteralPath $customPath -Destination $backup}
$custom=$shell.CreateShortcut($customPath)
$custom.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$custom.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'"'
$custom.WindowStyle=7
$custom.WorkingDirectory=$root
$custom.IconLocation=$icon+',0'
$custom.Description='Kurumi Codex independent client'
$custom.Save()
$nativePath=Join-Path $desktop 'Codex 原生.lnk'
if(-not (Test-Path -LiteralPath $nativePath)){
 $entry=Get-StartApps | Where-Object {$_.AppID -like 'OpenAI.Codex_*!App'} | Select-Object -First 1
 if($entry){$native=$shell.CreateShortcut($nativePath);$native.TargetPath=Join-Path $env:WINDIR 'explorer.exe';$native.Arguments='shell:AppsFolder\'+$entry.AppID;$native.Description='Original Codex desktop app';$native.Save()}
}
Write-Output $customPath
Write-Output $nativePath
