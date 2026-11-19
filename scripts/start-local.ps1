param(
    [string]$OipExe = $env:CASEFLOW_OIP_EXE,
    [string]$OipProject,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $repo 'mes/backend'
$web = Join-Path $repo 'mes/web'
$localBuild = Join-Path $repo '../../work/oip-source/apps/desktop/release/win-unpacked/Open Industry Project.exe'
if (-not $OipProject) { $OipProject = Join-Path $repo 'oip/project' }
$project = (Resolve-Path -LiteralPath $OipProject).Path
if (-not (Test-Path -LiteralPath (Join-Path $project 'project.json'))) {
    throw "OIP 프로젝트를 찾지 못했습니다: $project"
}

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

function Wait-Port([int]$Port, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (Test-Port $Port) { return }
        Start-Sleep -Milliseconds 700
    } while ((Get-Date) -lt $deadline)
    throw "현장 연결 포트 $Port 가 $Seconds 초 안에 열리지 않았습니다. OIP의 실행 상태와 설정을 확인하세요."
}

function Invoke-OipTool([string]$Name, [hashtable]$Arguments = @{}) {
    $body = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'; params = @{ name = $Name; arguments = $Arguments } } | ConvertTo-Json -Depth 8 -Compress
    $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5189/mcp' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 12
    if ($reply.error -or $reply.result.isError) { throw "OIP $Name 실패: $($reply | ConvertTo-Json -Depth 5 -Compress)" }
    $content = $reply.result.content | Where-Object type -EQ 'text' | Select-Object -First 1
    if (-not $content) { throw "OIP $Name 응답이 비어 있습니다." }
    return $content.text | ConvertFrom-Json
}

$alreadyOpen = Test-Port 5189
if (-not $alreadyOpen) {
    if (Test-Port 4843) { throw 'OIP PLC는 실행 중이지만 로컬 제어 연결(5189)이 꺼져 있습니다. 실행 중인 OIP에서 Agent connections를 켜거나 종료 후 다시 시작하세요.' }
    if (-not $OipExe -and (Test-Path -LiteralPath $localBuild)) { $OipExe = (Resolve-Path -LiteralPath $localBuild).Path }
    if (-not $OipExe -or -not (Test-Path -LiteralPath $OipExe)) {
        throw '패치된 OIP 실행본을 찾지 못했습니다. -OipExe 또는 CASEFLOW_OIP_EXE로 실행 파일 경로를 지정하세요.'
    }
    $previousPort = [Environment]::GetEnvironmentVariable('OIP_MCP_PORT', 'Process')
    try {
        $env:OIP_MCP_PORT = '5189'
        $env:OIP_BACKGROUND_ONLY = '1'
        # Passing a project at launch opens a native confirmation dialog. The agent door then
        # waits for an editor that cannot finish booting until someone clicks the dialog.
        # Open the already trusted/recent project through the agent door below instead.
        Start-Process -FilePath $OipExe -WindowStyle Minimized | Out-Null
    } finally {
        if ($null -eq $previousPort) { Remove-Item Env:OIP_MCP_PORT -ErrorAction SilentlyContinue }
        else { $env:OIP_MCP_PORT = $previousPort }
        Remove-Item Env:OIP_BACKGROUND_ONLY -ErrorAction SilentlyContinue
    }
    Write-Host "OIP를 시작했습니다: $project"
    Wait-Port 5189 45
}

$projects = Invoke-OipTool 'list_projects'
$openProject = $projects.projects | Where-Object open | Select-Object -First 1
if (-not $openProject -or $openProject.path -ne $project) {
    if ($alreadyOpen) { throw "다른 OIP 프로젝트가 열려 있습니다: $($openProject.path). 작업을 보호하기 위해 자동 전환하지 않았습니다." }
    Invoke-OipTool 'open_project' @{ project = $project } | Out-Null
}
$context = Invoke-OipTool 'get_context'
if (-not $context.running) {
    $started = Invoke-OipTool 'run'
    if (-not $started.running) { throw 'OIP Play 요청 후에도 공정이 시작되지 않았습니다.' }
    Write-Host 'OIP 프로젝트의 Play를 자동으로 시작했습니다.'
} elseif ($context.paused) {
    Invoke-OipTool 'resume' | Out-Null
    Write-Host '일시 정지된 OIP 공정을 재개했습니다.'
} else {
    Write-Host 'OIP 공정이 이미 실행 중입니다.'
}
Wait-Port 4843 20

if (-not (Test-Port 8085)) {
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Java 25가 필요합니다.' }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'mvnw.cmd spring-boot:run' -WorkingDirectory $backend -WindowStyle Hidden | Out-Null
    Write-Host 'MES 서버를 시작했습니다.'
    Wait-Port 8085 55
}

if (-not (Test-Port 5173)) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js와 npm이 필요합니다.' }
    if (-not (Test-Path -LiteralPath (Join-Path $web 'node_modules'))) {
        Push-Location $web
        try { npm ci; if ($LASTEXITCODE -ne 0) { throw '웹 의존성 설치에 실패했습니다.' } }
        finally { Pop-Location }
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev -- --host 127.0.0.1' -WorkingDirectory $web -WindowStyle Hidden | Out-Null
    Write-Host 'MES 웹 화면을 시작했습니다.'
    Wait-Port 5173 30
}

if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' | Out-Null }
Write-Host 'OIP Play / PLC 4843 / 현장 연결 5189 / MES 서버 8085 / MES 웹 5173 준비 완료'
