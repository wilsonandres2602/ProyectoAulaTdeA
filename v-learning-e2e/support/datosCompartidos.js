import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Datos compartidos que crea el proyecto `setup` (tests/datos.setup.js) por la UI y que usan los
 * specs de la misma corrida. Solo se guardan IDs, nombres y correos: nunca contraseñas (todas las
 * cuentas activadas usan E2E_PASSWORD, que sale del entorno).
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archivo = () => path.join(RAIZ, "resultados", `datos-${process.env.ID_EJECUCION}.json`);

export function guardarDatos(datos) {
  fs.mkdirSync(path.dirname(archivo()), { recursive: true });
  const limpio = JSON.parse(JSON.stringify(datos, (k, v) => (/password|temporal|token/i.test(k) ? undefined : v)));
  fs.writeFileSync(archivo(), JSON.stringify(limpio, null, 2));
}

/** Lee los datos de la corrida actual. Falla con un mensaje claro si el setup no corrió. */
export function leerDatos() {
  try {
    return JSON.parse(fs.readFileSync(archivo(), "utf8"));
  } catch {
    throw new Error(`No hay datos compartidos para la corrida ${process.env.ID_EJECUCION}: `
      + "el proyecto «setup» (tests/datos.setup.js) no corrió o falló. No uses --no-deps con este spec.");
  }
}
