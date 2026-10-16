param(
    [int]$BackendPort = 8000,
    [int]$VoicePort = 8787,
    [switch]$RealVoice,
    [switch]$Gateway,
    [string]$ModelEnvPath,
    [string]$VoiceEnvPath,
    [ValidateSet('u_new', 'u_small')][string]$UserId = 'u_new'
)
$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path $PSScriptRoot -Parent
$demoLogs = Join-Path $demoRoot '.demo-runtime'
New-Item -ItemType Directory -Force $demoLogs | Out-Null
$demoPython = Join-Path $demoRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $demoPython)) { $demoPython = (Get-Command python).Source }
$demoNode = (Get-Command node).Source
foreach ($demoPort in @($BackendPort, $VoicePort)) {
    $demoListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $demoPort)
    try { $demoListener.Start() } finally { $demoListener.Stop() }
}
if (-not (Test-Path -LiteralPath (Join-Path $demoRoot 'frontend/dist/app.js'))) { throw 'Build frontend first: cd frontend; node scripts/build.mjs' }
if (-not (Test-Path -LiteralPath (Join-Path $demoRoot 'voice/node_modules/tsx'))) { throw 'Install voice dependencies first.' }
$demoVariables = @{
    OFFLINE = '1'; ASSISTANT_ENGINE = 'model';
    ICARUS_MODEL_OFFLINE = $(if ($Gateway) { '0' } else { '1' });
    FAKE_ELEVENLABS = $(if ($RealVoice) { '0' } else { '1' });
    CORS_ORIGINS = "http://localhost:$VoicePort,http://127.0.0.1:$VoicePort";
    PORT = "$VoicePort"; VOICE_HOST = '127.0.0.1'; ASSISTANT_MODE = 'http';
    ASSISTANT_URL = "http://127.0.0.1:$BackendPort/chat";
    ASSISTANT_USER_ID = $UserId; TTS_WARMUP_MINUTES = '0'
}
if ($ModelEnvPath) {
    if (-not (Test-Path -LiteralPath $ModelEnvPath)) { throw 'Model environment file not found.' }
    $demoVariables.ICARUS_MODEL_ENV_FILE = (Resolve-Path -LiteralPath $ModelEnvPath).Path
}
if ($VoiceEnvPath) {
    if (-not (Test-Path -LiteralPath $VoiceEnvPath)) { throw 'Voice environment file not found.' }
    $demoVariables.DOTENV_CONFIG_PATH = (Resolve-Path -LiteralPath $VoiceEnvPath).Path
}
$demoPrevious = @{}
foreach ($demoKey in $demoVariables.Keys) {
    $demoPrevious[$demoKey] = [Environment]::GetEnvironmentVariable($demoKey, 'Process')
    [Environment]::SetEnvironmentVariable($demoKey, $demoVariables[$demoKey], 'Process')
}
$demoBackend = $null; $demoVoice = $null
try {
    $demoBackend = Start-Process -FilePath $demoPython -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") -WorkingDirectory (Join-Path $demoRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $demoLogs 'backend.out.log') -RedirectStandardError (Join-Path $demoLogs 'backend.err.log')
    $demoVoice = Start-Process -FilePath $demoNode -ArgumentList @('--import', 'tsx', 'src/server/index.ts') -WorkingDirectory (Join-Path $demoRoot 'voice') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $demoLogs 'voice.out.log') -RedirectStandardError (Join-Path $demoLogs 'voice.err.log')
    foreach ($demoUrl in @("http://127.0.0.1:$BackendPort/health", "http://127.0.0.1:$VoicePort/api/health")) {
        $demoReady = $false
        for ($demoTry = 0; $demoTry -lt 30; $demoTry++) {
            try { Invoke-RestMethod $demoUrl -TimeoutSec 2 | Out-Null; $demoReady = $true; break } catch { Start-Sleep -Milliseconds 300 }
        }
        if (-not $demoReady) { throw "Service did not start: $demoUrl. Check $demoLogs" }
    }
    $demoHealth = Invoke-RestMethod "http://127.0.0.1:$BackendPort/health" -TimeoutSec 3
    $demoWantOffline = -not $Gateway
    if ($demoHealth.engine -ne 'model' -or [bool]$demoHealth.model_offline -ne $demoWantOffline) {
        throw "Backend runs engine '$($demoHealth.engine)' (model_offline=$($demoHealth.model_offline)), expected engine 'model' (model_offline=$demoWantOffline). Is another backend on port ${BackendPort}?"
    }
    Write-Host "Backend: $($demoHealth.assistant) (engine $($demoHealth.engine))"
    Write-Host "Demo: http://localhost:$VoicePort/app/?backend=http://127.0.0.1:$BackendPort&user=$UserId"
    Write-Host "Backend PID $($demoBackend.Id); voice PID $($demoVoice.Id). Stop with Stop-Process -Id $($demoBackend.Id),$($demoVoice.Id)"
    if (-not $RealVoice) { Write-Host 'Voice is FAKE: tones and scripted transcripts. Use -RealVoice with voice/.env for real speech.' }
} catch {
    foreach ($demoProcess in @($demoBackend, $demoVoice)) { if ($demoProcess -and -not $demoProcess.HasExited) { Stop-Process -Id $demoProcess.Id } }
    throw
} finally {
    foreach ($demoKey in $demoVariables.Keys) { [Environment]::SetEnvironmentVariable($demoKey, $demoPrevious[$demoKey], 'Process') }
}
