import { test, expect } from "../support/test.js";
import { caso, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { armarCurso, sesion } from "../support/cursos.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

const base = { hu: "HU-013", rf: "RF-011", prioridad: "P3" };
const MSG_GUARDADO = "Guardamos tus preferencias de notificación.";

const campana = (page) => page.getByRole("button", { name: /^Notificaciones/ });
const centro = (page) => page.getByRole("region", { name: "Centro de notificaciones" });
const menu = (page, nombre) => page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: nombre, exact: true });
const seccionNotif = (page) => page.getByRole("region", { name: "Notificaciones" }).filter({ has: page.getByRole("button", { name: "Guardar notificaciones" }) });

/** /configuracion desde el menú; devuelve la tarjeta «Notificaciones» ya cargada. */
async function abrirPreferencias(page) {
  await menu(page, "Configuración").click();
  await expect(page).toHaveURL(/\/configuracion/);
  const s = seccionNotif(page);
  await expect(s.getByRole("switch", { name: "Recibir recordatorios y avisos" })).toBeVisible();
  return s;
}

/** «Guardar notificaciones» → PUT 200 y «Guardamos tus preferencias de notificación.» */
async function guardarPreferencias(page, s) {
  const resp = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === "/api/notificaciones/preferencias");
  await s.getByRole("button", { name: "Guardar notificaciones" }).click();
  expect((await resp).status()).toBe(200);
  await expect(page.getByText(MSG_GUARDADO).first()).toBeVisible();
}

/** Estudiante desechable con la sesión abierta. */
async function estudiante(abrirContexto, etiqueta) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  usuarioProbado(est.correo);
  return { est, page: await sesion(abrirContexto, est) };
}

test.describe("HU-013 · Notificaciones y recordatorios (RF-011, RF-047)", () => {
  // ------------------------------------------------------------------ CP-HU013-01
  test("CP-HU013-01 — Notificación por evento en el centro de notificaciones @P3 @HU-013", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU013-01", tecnica: "flujo", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "Adicional (observable)",
      ajuste: "Al abrir la campana se marcan como leídas todas las visibles (no hay un control por aviso), así que el «sin leer» se comprueba en el contador de la campana antes de abrirla" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notifins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "notifevt" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Notif", inscritos: [est] });
    const TAREA = "Tarea con aviso";
    const tareaId = await test.step(`1. El instructor crea «${TAREA}» en el curso`, async () => {
      const pi = await sesion(abrirContexto, ins);
      const ed = new CursosInstructorPage(pi);
      await ed.ir();
      await ed.abrirEditor(curso.titulo);
      const id = await ed.crearTarea(TAREA);
      await expect(pi.getByText("Tarea creada y notificada a los estudiantes.").first()).toBeVisible();
      await cerrarSesion(pi);
      await pi.context().close();
      return id;
    });
    const page = await sesion(abrirContexto, est);
    await test.step("2. El estudiante abre «Notificaciones» (había avisos sin leer): está el aviso de la tarea", async () => {
      // El «(sin leer)» de cada aviso no se alcanza a ver: abrir la campana marca todos como leídos de inmediato.
      // Por eso el estado «sin leer» se comprueba en el contador de la campana, antes de abrirla.
      const nombre = await campana(page).getAttribute("aria-label");
      test.info().annotations.push({ type: "campanaAntes", description: nombre });
      await expect(campana(page)).toHaveAccessibleName(/^Notificaciones: \d+ sin leer$/);
      await campana(page).click();
      await expect(centro(page)).toBeVisible();
      const aviso = centro(page).getByRole("listitem").filter({ hasText: `Nueva tarea: ${TAREA}` });
      await expect(aviso).toHaveCount(1);
      test.info().annotations.push({ type: "aviso", description: (await aviso.innerText()).replace(/\s+/g, " ") });
    });
    await test.step("Resultado: queda marcado como leído", async () => {
      await expect(campana(page)).toHaveAccessibleName("Notificaciones");
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(campana(page)).toHaveAccessibleName("Notificaciones");
      await campana(page).click();
      const aviso = centro(page).getByRole("listitem").filter({ hasText: `Nueva tarea: ${TAREA}` });
      await expect(aviso).toHaveCount(1);
      await expect(aviso).not.toContainText("(sin leer)");
    });
    await verificarAuditoria(abrirContexto, { accion: "TAREA_CREADA", resultado: "Permitido", usuario: ins.correo, recurso: `tareas/${tareaId}` });
  });

  // ------------------------------------------------------------------ CP-HU013-02
  test("CP-HU013-02 — Notificaciones deshabilitadas: la preferencia persiste @P3 @HU-013", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU013-02", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { est, page } = await estudiante(abrirContexto, "notifoff");
    await test.step("1. /configuracion → desactivar «Recibir recordatorios y avisos» → «Guardar notificaciones»", async () => {
      const s = await abrirPreferencias(page);
      const sw = s.getByRole("switch", { name: "Recibir recordatorios y avisos" });
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await guardarPreferencias(page, s);
    });
    await test.step("2. Recargar: sigue desactivado", async () => {
      await page.reload();
      await expect(seccionNotif(page).getByRole("switch", { name: "Recibir recordatorios y avisos" })).toHaveAttribute("aria-checked", "false");
    });
    await test.step("3. Volver a entrar (contexto nuevo): sigue desactivado", async () => {
      await page.context().close();
      const p2 = await sesion(abrirContexto, est);
      const s = await abrirPreferencias(p2);
      await expect(s.getByRole("switch", { name: "Recibir recordatorios y avisos" })).toHaveAttribute("aria-checked", "false");
      await expect(s.getByLabel("¿Por dónde quieres recibirlas?")).toBeDisabled();
    });
    await verificarAuditoria(abrirContexto, { accion: "HTTP PUT (200)", resultado: "Permitido", usuario: est.correo, recurso: "/api/notificaciones/preferencias" });
  });

  // ------------------------------------------------------------------ CP-HU013-03
  test("CP-HU013-03 — Canal alterno: plataforma y correo @P3 @HU-013", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU013-03", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "Solo se comprueba que la preferencia persiste: la entrega por correo queda bloqueada (no hay SMTP en el entorno de pruebas)" });
    const { est, page } = await estudiante(abrirContexto, "notifcanal");
    await test.step("1. «¿Por dónde quieres recibirlas?» → «Plataforma y correo institucional» → «Guardar notificaciones»", async () => {
      const s = await abrirPreferencias(page);
      const canal = s.getByLabel("¿Por dónde quieres recibirlas?");
      await expect(canal).toHaveValue("PLATAFORMA");
      await canal.selectOption({ label: "Plataforma y correo institucional" });
      await guardarPreferencias(page, s);
    });
    await test.step("Resultado: la preferencia persiste al recargar", async () => {
      await page.reload();
      const canal = seccionNotif(page).getByLabel("¿Por dónde quieres recibirlas?");
      await expect(canal).toHaveValue("CORREO");
      await expect(canal.locator("option:checked")).toHaveText("Plataforma y correo institucional");
    });
    await verificarAuditoria(abrirContexto, { accion: "HTTP PUT (200)", resultado: "Permitido", usuario: est.correo, recurso: "/api/notificaciones/preferencias" });
  });

  // ------------------------------------------------------------------ CP-HU013-04
  test("CP-HU013-04 — Resumen diario y hora (RF-047) @P3 @HU-013", async ({ abrirContexto }) => {
    caso({ ...base, rf: "RF-047", caso: "CP-HU013-04", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "RF-047 (adicional)" });
    const { page } = await estudiante(abrirContexto, "notifresumen");
    await test.step("1. Activar «Resumen diario» → «Hora del resumen» 07:30 → «Guardar notificaciones»", async () => {
      const s = await abrirPreferencias(page);
      const sw = s.getByRole("switch", { name: "Resumen diario" });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(s.getByLabel("Hora del resumen")).toHaveCount(0);
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      const hora = s.getByLabel("Hora del resumen");
      await expect(hora).toBeVisible();
      await expect(s.getByText("Lo enviamos con un margen de 5 minutos.")).toBeVisible();
      // <input type="time">: se teclea por segmentos como una persona (hora, minutos y, si existe, a. m.).
      await hora.click();
      await page.keyboard.press("Home");
      await page.keyboard.type("0730a", { delay: 80 });
      await expect(hora).toHaveValue("07:30");
      await guardarPreferencias(page, s);
    });
    await test.step("Resultado: la preferencia persiste al recargar", async () => {
      await page.reload();
      const s = seccionNotif(page);
      await expect(s.getByRole("switch", { name: "Resumen diario" })).toHaveAttribute("aria-checked", "true");
      await expect(s.getByLabel("Hora del resumen")).toHaveValue("07:30");
      await expect(s.getByText("Lo enviamos con un margen de 5 minutos.")).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU013-07
  test("CP-HU013-07 — Posponer 1 día, 3 días o 1 semana desde la UI @P3 @HU-013", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU013-07", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3", defecto: "D-11" });
    const { page } = await estudiante(abrirContexto, "notifposui");
    await test.step("Precondición: el estudiante tiene notificaciones (las del onboarding)", async () => {
      await campana(page).click();
      await expect(centro(page).getByRole("listitem").first()).toBeVisible();
      test.info().annotations.push({ type: "avisos", description: (await centro(page).getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | ") });
    });
    await test.step("1. «Notificaciones» → buscar «Posponer» en el aviso: opciones 1 día, 3 días y 1 semana", async () => {
      const aviso = centro(page).getByRole("listitem").first();
      const controles = await aviso.locator("button, select, [role=menuitem], a").allInnerTexts();
      test.info().annotations.push({ type: "controlesDelAviso", description: JSON.stringify(controles) });
      // D-11 (defecto, decisión del usuario del 10/11/2026): la UI no tiene este control.
      await expect(aviso.getByRole("button", { name: /Posponer/i }).or(aviso.getByLabel(/Posponer/i)), "D-11: no hay control para posponer").toBeVisible();
      await aviso.getByRole("button", { name: /Posponer/i }).click();
      for (const o of ["1 día", "3 días", "1 semana"]) await expect(page.getByText(o, { exact: true })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU013-09 (API, parametrizado)
  for (const [opcion, nombre] of [["1_DIA", "1 día"], ["3_DIAS", "3 días"], ["1_SEMANA", "1 semana"], ["2_HORAS", "opción inválida"]]) {
    test(`CP-HU013-09 — El backend pospone: ${nombre} @P3 @HU-013 @api`, async ({ abrirContexto }) => {
      caso({ ...base, caso: "CP-HU013-09", tecnica: opcion === "2_HORAS" ? "partición" : "funcional", clasificacion: "Ruta Alterna", clase: "E2E-API",
        referenciaPlan: "§7.3 (D-11: el backend sí lo soporta)",
        ajuste: "La respuesta (NotificacionDto) no expone la fecha hasta la que queda pospuesta: se comprueba que la notificación deja de aparecer en el listado y vuelve a quedar sin leer" });
      const { est, page } = await estudiante(abrirContexto, `notifpos${opcion.toLowerCase().replace("_", "")}`);
      const token = await tokenDeSesion(page);
      const n = await test.step("Precondición: una notificación creada por un evento (onboarding)", async () => {
        const r = await pedir(page, "GET", "/api/notificaciones?limite=30", { token });
        expect(r.status).toBe(200);
        expect(r.cuerpo.notificaciones.length).toBeGreaterThan(0);
        return r.cuerpo.notificaciones[0];
      });
      test.info().annotations.push({ type: "notificacion", description: `${n.id} «${n.titulo}»` });
      if (opcion === "2_HORAS") {
        await test.step("1. POST /posponer con una opción inválida → 400 «Elige una opción válida: 1 día, 3 días o 1 semana.»", async () => {
          const r = await pedir(page, "POST", `/api/notificaciones/${n.id}/posponer`, { token, datos: { opcion } });
          expect(r.status).toBe(400);
          expect(r.cuerpo?.mensaje).toBe("Elige una opción válida: 1 día, 3 días o 1 semana.");
          const l = await pedir(page, "GET", "/api/notificaciones?limite=30", { token });
          expect(l.cuerpo.notificaciones.map((x) => x.id)).toContain(n.id);
        });
        return;
      }
      await test.step(`1. POST /api/notificaciones/${n.id}/posponer con «${opcion}» → 2xx`, async () => {
        const r = await pedir(page, "POST", `/api/notificaciones/${n.id}/posponer`, { token, datos: { opcion } });
        test.info().annotations.push({ type: "respuesta", description: `${r.status} ${JSON.stringify(r.cuerpo)}` });
        expect(r.status).toBeGreaterThanOrEqual(200);
        expect(r.status).toBeLessThan(300);
        expect(r.cuerpo).toMatchObject({ id: n.id, leida: false });
      });
      await test.step("2. Listar: la notificación ya no aparece (queda pospuesta)", async () => {
        const l = await pedir(page, "GET", "/api/notificaciones?limite=30", { token });
        expect(l.status).toBe(200);
        expect(l.cuerpo.notificaciones.map((x) => x.id)).not.toContain(n.id);
      });
      await verificarAuditoria(abrirContexto, {
        accion: "HTTP POST (200)", resultado: "Permitido", usuario: est.correo, recurso: `/api/notificaciones/${n.id}/posponer`,
      });
    });
  }
});
