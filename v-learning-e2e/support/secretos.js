import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Registro de valores secretos de la corrida (contraseñas, OTP, contraseñas temporales y tokens de
 * enlaces). Vive FUERA del repo, en la carpeta temporal del sistema. El reporter lo usa para borrar
 * esos valores de los traces antes de copiarlos a evidencias/ y al reporte HTML, y lo elimina al final.
 * Nunca se escribe en el JSONL, en los logs ni en las evidencias.
 */
export function archivoSecretos(idEjecucion = process.env.ID_EJECUCION) {
  return path.join(os.tmpdir(), `vl-e2e-secretos-${idEjecucion}.json`);
}

export function registrarSecreto(valor) {
  if (!valor || String(valor).length < 4) return;
  const archivo = archivoSecretos();
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(archivo, "utf8")); } catch { /* primera vez */ }
  if (!lista.includes(String(valor))) {
    lista.push(String(valor));
    fs.writeFileSync(archivo, JSON.stringify(lista), { mode: 0o600 });
  }
}

export function leerSecretos(idEjecucion) {
  try { return JSON.parse(fs.readFileSync(archivoSecretos(idEjecucion), "utf8")); } catch { return []; }
}

export function borrarRegistroSecretos(idEjecucion) {
  try { fs.unlinkSync(archivoSecretos(idEjecucion)); } catch { /* ya no existe */ }
}

/**
 * CSS que difumina en pantalla (video y capturas) los valores que la app muestra en modo
 * desarrollo: el código OTP, la contraseña temporal y los enlaces con token. Es solo visual:
 * no cambia el DOM, los textos ni el comportamiento de la app.
 */
export const CSS_ENMASCARAR = `
  [data-testid="pass-temporal"],
  .font-mono.font-extrabold,
  input[autocomplete="one-time-code"],
  input[autocomplete$="-password"][type="text"],
  a.break-all,
  a[href*="token="] { filter: blur(7px) !important; }
`;

export const SCRIPT_ENMASCARAR = `(() => {
  const poner = () => {
    if (document.getElementById("vl-e2e-mascara")) return;
    const s = document.createElement("style");
    s.id = "vl-e2e-mascara";
    s.textContent = ${JSON.stringify(CSS_ENMASCARAR)};
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", poner); else poner();
})();`;
