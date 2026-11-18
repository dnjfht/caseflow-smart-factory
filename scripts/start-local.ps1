param(
    [string]$OipExe = $env:CASEFLOW_OIP_EXE,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $repo 'mes/backend'
$web = Join-Path $repo 'mes/web'

function Test-Port([int]$Port) {
    try {
        $socket = [System.Net.Sockets.TcpClient]::new()
        $result = $socket.BeginConnect('127.0.0.1', $Port, $null, $null)
        $connected = $result.AsyncWaitHandle.WaitOne(300)
        if ($connected) { $socket.EndConnect($result) }
        $socket.Dispose()
        return $connected
    } catch { return $false }
}

if (-not (Test-Port 4843) -or -not (Test-Port 5189)) {
    if (-not $OipExe) {
        $localBuild = Join-Path $repo '../../work/oip-source/apps/desktop/release/win-unpacked/Open Industry Project.exe'
        if (Test-Path -LiteralPath $localBuild) { $OipExe = (Resolve-Path -LiteralPath $localBuild).Path }
    }
    if (-not $OipExe -or -not (Test-Path -LiteralPath $OipExe)) {
        throw 'OIP 실행본을 찾지 못했습니다. -OipExe 또는 CASEFLOW_OIP_EXE로 패치된 OIP 실행 파일 경로를 지정하세요.'
    }
    Start-Process -FilePath $OipExe -WindowStyle Hidden
    Write-Host 'OIP 실행을 요청했습니다. 마지막으로 열었던 공정이 자동 복원되는지 확인하세요.'
}

if (-not (Test-Port 8085)) {
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Java 25가 필요합니다.' }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'mvnw.cmd spring-boot:run' -WorkingDirectory $backend -WindowStyle Hidden
    Write-Host 'MES 서버를 시작했습니다.'
}

if (-not (Test-Port 5173)) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js와 npm이 필요합니다.' }
    if (-not (Test-Path -LiteralPath (Join-Path $web 'node_modules'))) {
        Push-Location $web
        try { npm ci; if ($LASTEXITCODE -ne 0) { throw '웹 의존성 설치에 실패했습니다.' } }
        finally { Pop-Location }
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev -- --host 127.0.0.1' -WorkingDirectory $web -WindowStyle Hidden
    Write-Host 'MES 웹 화면을 시작했습니다.'
}

if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' }
Write-Host 'OIP PLC 4843 / 현장 연결 5189 / MES 서버 8085 / MES 웹 5173'
