# 🏁 TuneIT — Pruebas Automatizadas E2E en Cypress (Flujo Crítico)

Suite de pruebas End-to-End (E2E) del Flujo Crítico de **TuneIT**, apuntando al despliegue en producción (`https://tuneit-chi.vercel.app`).

## 📋 Etapas del Flujo Crítico Evaluadas (`cypress/e2e/flujo_critico_tuneit.cy.ts`)

1. **Etapa 1 — Autenticación e Inicio de Sesión (`POST /api/v1/auth/login`):**
   - Acceso a la plataforma como visitante, prueba del widget de telemetría e inicio de sesión con validación de código HTTP `200 OK`.
2. **Etapa 2 — Registro y Selección de Vehículo en Garaje (`POST /api/v1/vehicles`):**
   - Creación de vehículo (*Volkswagen Golf GTI MK7.5 - 230 HP / 350 Nm*), validación de nivel de confianza (`Dyno Verificado`) y activación en el garaje.
3. **Etapa 3 — Simulación Dinamométrica y Recomendaciones Técnicas (`POST /api/v1/estimate`):**
   - Selección de piezas del catálogo (*Downpipe*, *Admisión de Aire Frío* e *Intercooler Frontal de 85 mm*), cálculo de curvas de potencia/torque y marcado del checklist obligatorio (*Reprogramación de ECU Stage 2*).
4. **Etapa 4 — Guardado y Persistencia del Proyecto (`POST /api/v1/builds`):**
   - Registro del proyecto `Golf GTI Stage 2 - Flujo Crítico` y verificación en el *Historial de Builds Guardados*.

## 📂 Estructura de Archivos

- `cypress/e2e/flujo_critico_tuneit.cy.ts`: Script principal de la prueba E2E del flujo crítico.
- `cypress/reports/reporte_pruebas_tuneit.html`: Reporte ejecutivo visual en HTML con matriz de resultados y capturas de evidencia.
- `cypress/screenshots/`: Evidencias fotográficas PNG capturadas automáticamente en cada etapa.
- `cypress.config.ts`: Configuración de Cypress y generador automático de reportes.

## 🚀 Cómo Ejecutar las Pruebas

```bash
npm install cypress --save-dev
npx cypress open
```
O para ejecutar por consola y regenerar el reporte:
```bash
npx cypress run --spec "cypress/e2e/flujo_critico_tuneit.cy.ts"
```
