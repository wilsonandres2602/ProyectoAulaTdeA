import path from "node:path";

/**
 * Historial auditable: un JSONL por origen, cada uno con su propia cadena de hashes y un solo
 * escritor, para que las corridas locales y las del CI no bifurquen la cadena.
 *  - local: auditoria/ejecuciones-local.jsonl (corridas en una máquina de desarrollo)
 *  - ci:    auditoria/ejecuciones-ci.jsonl    (GitHub Actions; pone CI=true)
 * scripts/lib/cierre.cjs (Excel e informe) combina los dos por fecha de inicio.
 */
export const ORIGENES = ["local", "ci"];

export function archivoHistorial(origen = origenActual(), raiz = process.cwd()) {
  return path.join(raiz, "auditoria", `ejecuciones-${origen}.jsonl`);
}

/** Origen de la corrida actual: «ci» si la variable CI vale true (GitHub Actions), si no «local». */
export function origenActual() {
  return String(process.env.CI ?? "").toLowerCase() === "true" ? "ci" : "local";
}
