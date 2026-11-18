@echo off
title TuneIt - Generador de Reporte Oficial Cypress (HTML + Video + Capturas)
color 0a
echo ====================================================================
echo   EJECUTANDO FLUJO CRITICO Y GENERANDO REPORTE OFICIAL DE TUNEIT
echo ====================================================================
echo.
cd /d %~dp0frontend
call npx -y cypress run --spec "cypress/e2e/flujo_critico_tuneit.cy.ts"

echo.
echo ====================================================================
echo   EVIDENCIAS GENERADAS EXITOSAMENTE EN:
echo   1. Reporte HTML: frontend\cypress\reports\reporte_pruebas_tuneit.html
echo   2. Capturas PNG: frontend\cypress\screenshots\
echo   3. Video MP4:    frontend\cypress\videos\
echo ====================================================================
echo.
if exist "cypress\reports\reporte_pruebas_tuneit.html" (
    start "" "cypress\reports\reporte_pruebas_tuneit.html"
)
pause

