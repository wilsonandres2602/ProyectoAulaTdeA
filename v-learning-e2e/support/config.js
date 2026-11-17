import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

/** Configuración de la corrida. Las contraseñas solo salen de variables de entorno. */
export const cfg = {
  baseURL: process.env.BASE_URL || "http://localhost:5173",
  adminCorreo: process.env.ADMIN_CORREO || "admin@tdea.edu.co",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  instructorDemoCorreo: process.env.INSTRUCTOR_DEMO_CORREO || "laura.mejia@tdea.edu.co",
  instructorDemoPassword: process.env.INSTRUCTOR_DEMO_PASSWORD || "",
  correoExistente: process.env.CORREO_EXISTENTE || "andres.gomez@tdea.edu.co",
  e2ePassword: process.env.E2E_PASSWORD || "",
  dominio: process.env.APP_DOMINIO || "tdea.edu.co",
  otpMinutos: num(process.env.OTP_MINUTOS, 10),
  ciclo: num(process.env.CICLO, 1),
  slowMo: num(process.env.SLOW_MO, 400),
  tecleoMs: num(process.env.TECLEO_MS, 40),
  appRepoDir: process.env.APP_REPO_DIR || "../v-learning-platform",
  appCommit: process.env.APP_COMMIT || "",
  ejecutadoPor: process.env.EJECUTADO_POR || "",
  ollamaDisponible: process.env.OLLAMA_DISPONIBLE === "1",
};

/**
 * Etiqueta del campo de correo en /login, /recuperar, /desbloquear y «Nuevo usuario». Hoy la app dice
 * «Correo institucional»; cuando acepte también @gmail.com, @outlook.com y los dominios que agregue el
 * admin, la etiqueta (y APP_DOMINIO) se cambian aquí o en .env, en un solo lugar.
 */
export const ETIQUETA_CORREO = process.env.ETIQUETA_CORREO || "Correo institucional";

/** La misma etiqueta como RegExp que empieza por ella (p. ej. para el nombre accesible con «*» o descripción). */
export const ETIQUETA_CORREO_RE = new RegExp(`^${ETIQUETA_CORREO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

// dotenv corta en «#» los valores sin comillas: una contraseña así se teclearía incompleta y
// sumaría fallos de login reales (y bloquearía la cuenta). Se detecta leyendo el archivo.
if (existsSync(".env")) {
  for (const linea of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=([^'"].*#.*)$/);
    if (m && /PASSWORD|SECRET|TOKEN/.test(m[1])) {
      throw new Error(`.env: ${m[1]} contiene «#» y no está entre comillas; dotenv lo cortaría. Escríbelo como ${m[1]}='…'.`);
    }
  }
}

/** Falla temprano y con un mensaje claro si falta una variable obligatoria. */
export function exigir(...claves) {
  const faltan = claves.filter((k) => !cfg[k]);
  if (faltan.length) {
    throw new Error(`Faltan variables de entorno para este caso: ${faltan.join(", ")}. Revisa .env (ver .env.example).`);
  }
}
