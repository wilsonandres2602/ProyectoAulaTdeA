@echo off
chcp 65001 >nul
title Pruebas E2E V-Learning
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ejecutar-pruebas.ps1" %*
echo.
pause
