# 🏁 TuneIT — Plataforma Desplegada en Vercel y Pruebas E2E en Cypress

[![Estado Despliegue Vercel](https://img.shields.io/badge/Vercel_Producci%C3%B3n-Online-00f0ff?style=for-the-badge&logo=vercel&logoColor=white)](https://tuneit-chi.vercel.app/)
[![Pruebas Cypress E2E](https://img.shields.io/badge/Cypress_E2E-100%25_Aprobado-10b981?style=for-the-badge&logo=cypress&logoColor=white)](./cypress/reports/reporte_pruebas_tuneit.html)

---

## 🌐 Enlace Oficial del Despliegue en Producción (Vercel)

👉 **URL Pública de la Aplicación:** **[https://tuneit-chi.vercel.app/](https://tuneit-chi.vercel.app/)**

La plataforma **TuneIT** se encuentra desplegada en la nube mediante **Vercel** en una arquitectura híbrida que integra:
- **Frontend SPA:** React 19 + TypeScript + Vite + Tailwind CSS (`frontend/dist`).
- **Backend Serverless API:** Python + FastAPI expuesto mediante Vercel Serverless Functions (`api/index.py` y `vercel.json`).
- **Base de Datos Cloud:** PostgreSQL alojado en **Supabase** conectado mediante SQLAlchemy.

### ⚙️ Configuración de Despliegue en Vercel (`vercel.json` y `api/index.py`)

**`vercel.json`:**
```json
{
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.py"
    }
  ]
}
```

**`api/index.py` (Puente Serverless FastAPI):**
```python
import os
import sys

backend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.main import app
```

---

## 🧪 Suite de Pruebas Automatizadas E2E en Cypress (Flujo Crítico)

Las pruebas automatizadas en Cypress apuntan directamente al despliegue en vivo (`https://tuneit-chi.vercel.app`) y validan las **4 etapas del Flujo Crítico de Negocio** de principio a fin:

| Etapa | Caso de Prueba Validado | Endpoint REST API Verificado | Evidencia Fotográfica | Estado |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Autenticación e Inicio de Sesión** | `POST /api/v1/auth/login (200 OK)` | [`01_etapa1_login_exitoso.png`](./cypress/screenshots/01_etapa1_login_exitoso.png) | ✅ Aprobado |
| **2** | **Registro y Activación de Vehículo en Garaje** | `POST /api/v1/vehicles (200 OK)` | [`02_etapa2_vehiculo_registrado.png`](./cypress/screenshots/02_etapa2_vehiculo_registrado.png) | ✅ Aprobado |
| **3** | **Simulación Dinamométrica (Dyno AI) y Checklist ECU** | `POST /api/v1/estimate (200 OK)` | [`03_etapa3_simulacion_dyno_checklist.png`](./cypress/screenshots/03_etapa3_simulacion_dyno_checklist.png) | ✅ Aprobado |
| **4** | **Guardado y Persistencia del Proyecto (Build)** | `POST /api/v1/builds (200 OK)` | [`04_etapa4_build_guardado_historial.png`](./cypress/screenshots/04_etapa4_build_guardado_historial.png) | ✅ Aprobado |

---

## 📂 Estructura de Archivos en este Directorio (`tuneit/`)

- [`cypress/e2e/flujo_critico_tuneit.cy.ts`](./cypress/e2e/flujo_critico_tuneit.cy.ts): Código fuente completo de la prueba E2E paso a paso.
- [`cypress/reports/reporte_pruebas_tuneit.html`](./cypress/reports/reporte_pruebas_tuneit.html): Reporte ejecutivo visual en HTML con matriz de resultados y capturas incrustadas.
- [`cypress/screenshots/`](./cypress/screenshots/): Evidencias fotográficas PNG capturadas automáticamente por Cypress en cada etapa.
- [`cypress.config.ts`](./cypress.config.ts): Configuración de Cypress conectada a `https://tuneit-chi.vercel.app` y generador automático de reportes.
- [`vercel.json`](./vercel.json) y [`api/index.py`](./api/index.py): Archivos de configuración del despliegue en Vercel.

---

## 🚀 Cómo Ejecutar las Pruebas Localmente

1. Instalar dependencias:
   ```bash
   npm install cypress --save-dev
   ```
2. Abrir la interfaz visual de Cypress:
   ```bash
   npx cypress open
   ```
3. O ejecutar por consola generando el reporte HTML y capturas automáticamente:
   ```bash
   npx cypress run --spec "cypress/e2e/flujo_critico_tuneit.cy.ts"
   ```
