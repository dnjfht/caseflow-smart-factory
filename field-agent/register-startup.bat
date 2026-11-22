@echo off
chcp 65001 > nul
rem PC를 켜고 Windows에 로그인할 때마다 현장 에이전트가 자동으로 실행되게 등록합니다. 한 번만 더블클릭하세요.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\CaseFlow_FieldAgent.bat"
set "SCRIPT=%~dp0..\scripts\start-local.ps1"
for %%I in ("%SCRIPT%") do set "SCRIPT=%%~fI"
(
  echo @echo off
  echo rem CaseFlow field agent: OIP Desktop ^<-^> deployed MES. Remove with unregister-startup.bat
  echo timeout /t 20 /nobreak ^> nul
  echo powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -FieldAgent https://caseflow-mes-api.onrender.com -NoBrowser
  echo if errorlevel 1 pause
) > "%TARGET%"
if exist "%TARGET%" (
  echo 등록했습니다. 다음 로그인부터 OIP 실행 + 현장 에이전트 연결이 자동으로 시작됩니다.
  echo 등록 위치: %TARGET%
) else (
  echo 등록에 실패했습니다.
)
pause
