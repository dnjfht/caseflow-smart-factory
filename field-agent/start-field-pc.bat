@echo off
rem CaseFlow 현장 PC: OIP 데스크톱을 켜고 배포된 MES와 연결합니다. 이 파일을 더블클릭하세요.
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\start-local.ps1" -FieldAgent https://caseflow-mes-api.onrender.com
pause
