@echo off
chcp 65001 > nul
rem 자동 실행 등록을 해제합니다.
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CaseFlow_FieldAgent.bat"
if exist "%TARGET%" (del "%TARGET%" && echo 자동 실행을 해제했습니다.) else (echo 등록된 자동 실행이 없습니다.)
pause
