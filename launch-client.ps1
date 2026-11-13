$ErrorActionPreference='Stop'
$clientRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$logDirectory=Join-Path $env:APPDATA 'kurumi-codex-client\logs'
$launchLog=Join-Path $logDirectory 'launcher.log'
function Write-LaunchLog([string]$Message){
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Add-Content -LiteralPath $launchLog -Value ((Get-Date -Format o)+' '+$Message) -Encoding UTF8
}
try {
    foreach($requiredFile in @('main.cjs','preload.cjs','index.html','package.json')) {
        if(-not (Test-Path -LiteralPath (Join-Path $clientRoot $requiredFile) -PathType Leaf)){throw ('Missing client file: '+$requiredFile)}
    }
    $portableExe=Join-Path (Split-Path -Parent (Split-Path -Parent $clientRoot)) 'Kurumi Codex.exe'
    $runtimeCandidates=@($portableExe,(Join-Path $clientRoot 'runtime\electron.exe'),$env:KURUMI_ELECTRON,(Join-Path $env:LOCALAPPDATA 'KurumiCodex\runtime\electron.exe'),(Join-Path $env:USERPROFILE '.dsh\electron\electron.exe'))
    $electronPath=$runtimeCandidates | Where-Object {$_ -and (Test-Path -LiteralPath $_ -PathType Leaf)} | Select-Object -First 1
    if(-not $electronPath){throw 'Electron runtime not found. Restore the Electron runtime or set KURUMI_ELECTRON to electron.exe.'}
    foreach($requiredRuntimeFile in @('icudtl.dat','resources.pak','snapshot_blob.bin')) {
        if(-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $electronPath) $requiredRuntimeFile) -PathType Leaf)){throw ('Incomplete Electron runtime: '+$requiredRuntimeFile)}
    }
    # Change only this launcher process and its children, never user/system environment.
    $env:ELECTRON_RUN_AS_NODE=$null
    Write-LaunchLog ('Starting client; runtime='+$electronPath)
    # This is the interactive client window requested by the desktop shortcut.
    $startOptions=@{FilePath=$electronPath;WorkingDirectory=$clientRoot;WindowStyle='Normal';PassThru=$true}
    if($electronPath -ne $portableExe){$startOptions.ArgumentList='"'+$clientRoot+'"'}
    $clientProcess=Start-Process @startOptions
    Write-LaunchLog ('Started PID='+$clientProcess.Id)
    try {Wait-Process -Id $clientProcess.Id -Timeout 2 -ErrorAction Stop} catch {if(-not $clientProcess.HasExited){exit 0}}
    $clientProcess.Refresh()
    if($clientProcess.HasExited -and $clientProcess.ExitCode -ne 0){throw ('Client exited during startup; code='+$clientProcess.ExitCode)}
    Write-LaunchLog 'Startup handed off (or existing window activated).'
} catch {
    $failure=$_.Exception.Message
    try {Write-LaunchLog ('FAILED: '+$failure)} catch {}
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(('无法启动狂三客户端。'+[Environment]::NewLine+$failure+[Environment]::NewLine+'启动日志：'+$launchLog),'Kurumi Codex 启动失败','OK','Error') | Out-Null
    exit 1
}
