import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cuentaLista } from "../support/sesiones.js";
import { armarCurso, sesion } from "../support/cursos.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { escribir, escribirLargo } from "../support/humano.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { verificarAuditoria } from "../support/auditoria.js";

const base = { hu: "HU-012", rf: "RF-010" };
const MSG_PROHIBIDA = "Tu mensaje contiene lenguaje que no está permitido en la comunidad. Reescríbelo con respeto.";
const MSG_NO_MIEMBRO = "Solo los miembros del curso pueden usar la comunidad.";

/** El estudiante se inscribe en el curso del setup desde «Mis cursos» y abre /comunidad/<id>. */
async function entrarALaComunidad(page, curso) {
  await test.step(`Precondición: inscribirse en «${curso.titulo}» y abrir su Comunidad`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
    await page.getByRole("link", { name: "Comunidad", exact: true }).click();
    await expect(page).toHaveURL(/\/comunidad/);
    await page.getByRole("combobox", { name: "Curso" }).selectOption({ label: curso.titulo });
    await expect(page).toHaveURL(new RegExp(`/comunidad/${curso.id}$`));
    await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
  });
}

const lista = (page) => page.getByRole("log", { name: "Mensajes del curso" });
const campo = (page) => page.getByLabel("Escribe un mensaje");

/** Escribe el mensaje y lo envía; devuelve una promesa con el HTTP del POST (solo se observa). */
async function escribirYEnviar(page, texto) {
  await escribir(campo(page), texto);
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  return (await resp).status();
}

test.describe("HU-012 · Chat y foro en tiempo real (RF-010)", () => {
  // ------------------------------------------------------------------ CP-HU012-02
  test("CP-HU012-02 — Enviar y recibir por WebSocket, sin duplicados @P1 @HU-012", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU012-02", tecnica: "funcional", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "TC-CHAT-01; §7.3; §7.12.1 válida",
      ajuste: "El mensaje sale por POST /api/cursos/<id>/mensajes y llega a los demás por WebSocket; un POST correcto no se audita (solo errores y denegaciones)" });
    const d = leerDatos();
    const a = await cuentaLista(abrirContexto, { etiqueta: "chata" });
    const b = await cuentaLista(abrirContexto, { etiqueta: "chatb" });
    usuarioProbado(a.correo);
    const pa = await sesion(abrirContexto, a);
    await entrarALaComunidad(pa, d.cursoA);
    const pb = await sesion(abrirContexto, b);
    await entrarALaComunidad(pb, d.cursoA);
    const texto = `¿Alguien entendió el módulo 2? ${Date.now()}`;

    await test.step(`1. A escribe «${texto}» → «Enviar»; B lo ve sin recargar`, async () => {
      await escribir(campo(pa), texto);
      const navegacionesB = [];
      pb.on("framenavigated", (f) => { if (f === pb.mainFrame()) navegacionesB.push(f.url()); });
      const resp = pa.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()));
      await medir("entrega del mensaje a otro participante (WebSocket)", [U.ms(500, "HU-012 ≤ 500 ms"), U.s(1, "RF-010 < 1 s")],
        () => pa.getByRole("button", { name: "Enviar", exact: true }).click(),
        () => expect(lista(pb).getByText(texto, { exact: true })).toBeVisible());
      expect((await resp).status()).toBeLessThan(400);
      expect(navegacionesB, "B no recarga la página").toEqual([]);
    });
    await test.step("Resultado: una sola vez en B y en A, con el autor correcto", async () => {
      // Margen para un posible duplicado tardío (eco del WebSocket); solo se observa.
      await pb.waitForTimeout(1500);
      await expect(lista(pb).getByText(texto, { exact: true })).toHaveCount(1);
      await expect(lista(pa).getByText(texto, { exact: true })).toHaveCount(1);
      await expect(lista(pb).getByRole("listitem").filter({ hasText: texto }).getByText(a.nombre, { exact: true })).toBeVisible();
      await expect(lista(pa).getByRole("listitem").filter({ hasText: texto }).getByText("Tú", { exact: true })).toBeVisible();
      await expect(campo(pa)).toHaveValue("");
    });
  });

  // ------------------------------------------------------------------ CP-HU012-03
  test("CP-HU012-03 — Solo los miembros del curso usan la comunidad @P1 @HU-012", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU012-03", tecnica: "seguridad", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "TC-CHAT-01; §7.12.1 (403 NO_ES_MIEMBRO)", defecto: "D-25" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "chatajeno" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);

    await test.step(`1. page.goto('/comunidad/${d.cursoA.id}') sin estar inscrito`, async () => {
      const llamadas = [];
      const oir = (r) => { if (/\/api\/cursos\/\d+\/(mensajes|chat)/.test(r.url())) llamadas.push(`${r.request().method()} ${new URL(r.url()).pathname} (${r.status()})`); };
      page.on("response", oir);
      await page.goto(`/comunidad/${d.cursoA.id}`);
      await expect(page.getByRole("heading", { name: "Conversación del curso", level: 1 })).toBeVisible();
      await expect(page.getByText(/Todavía no tienes cursos con comunidad|Elige un curso para ver su conversación\./).first()).toBeVisible();
      page.off("response", oir);
      test.info().annotations.push({ type: "llamadasChat", description: JSON.stringify(llamadas) });
      const visto = await page.getByRole("main").innerText();
      test.info().annotations.push({ type: "mensajeNoMiembro", description: visto.includes(MSG_NO_MIEMBRO) ? MSG_NO_MIEMBRO : "(no aparece el texto del plan)" });
    });
    await test.step("Resultado: no ve la conversación ni puede escribir", async () => {
      await expect(lista(page)).toHaveCount(0);
      await expect(campo(page)).toHaveCount(0);
      await expect(page.getByText(d.cursoA.titulo, { exact: true })).toHaveCount(0);
    });
    await test.step(`Resultado (plan): «${MSG_NO_MIEMBRO}»`, async () => {
      // D-25 (defecto, decisión del usuario 11/11/2026): la UI no monta la sala de un curso ajeno ni llama
      // al API, así que este texto (403 NO_ES_MIEMBRO de ChatService) no se ve. Soft, para llegar a la auditoría.
      await expect.soft(page.getByText(MSG_NO_MIEMBRO), "D-25: no se muestra el mensaje del plan").toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP GET (403)", resultado: "Denegado", usuario: est.correo, recursoContiene: `/api/cursos/${d.cursoA.id}/`,
    });
  });

  // ------------------------------------------------------------------ CP-HU012-06
  test("CP-HU012-06 — Palabra prohibida @P1 @HU-012", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU012-06", tecnica: "partición", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "TC-CHAT-01; §7.12.1" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "chatgroseria" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await entrarALaComunidad(page, d.cursoA);
    const texto = `Eres un idiota ${Date.now()}`;

    await test.step("1. Texto con «idiota» → «Enviar»", async () => {
      expect(await escribirYEnviar(page, texto)).toBe(400);
    });
    await test.step("Resultado: el aviso del plan y el mensaje no aparece", async () => {
      await expect(page.getByRole("status").filter({ hasText: MSG_PROHIBIDA })).toBeVisible();
      await expect(lista(page).getByText(texto, { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(lista(page).getByText(texto, { exact: true })).toHaveCount(0);
    });
  });
});

// =================================================================== P2 de HU-012

const MSG_COLA = "Sin conexión: tu mensaje quedó en cola y se enviará solo cuando vuelva la conexión.";
const MSG_COLA_VACIADA = "Se enviaron los mensajes que estaban en cola.";
const MSG_SIN_COLA = "Sin conexión: el mensaje no se envió. Tu texto sigue en el campo para que lo envíes de nuevo.";
const MSG_LARGO = "El mensaje es muy largo. El máximo es 1000 caracteres.";
const aviso = (page) => page.getByRole("main").getByRole("status").filter({ hasText: /Sin conexión|Se enviaron|Escribe un mensaje\.|muy largo/ });

/** Texto de n caracteres que empieza con una marca única (para ubicarlo en la conversación). */
function textoDe(n) {
  const marcaUnica = `E2E${Date.now()} `;
  return (marcaUnica + "a".repeat(Math.max(0, n))).slice(0, n);
}

/** Estudiante desechable con la sesión abierta en la Comunidad del curso del setup. */
async function enLaComunidad(abrirContexto, curso, etiqueta) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  const page = await sesion(abrirContexto, est);
  await entrarALaComunidad(page, curso);
  return { est, page };
}

test.describe("HU-012 · Chat y foro en tiempo real, P2 (RF-010)", () => {
  // ------------------------------------------------------------------ CP-HU012-04
  test("CP-HU012-04 — Mensaje vacío o con solo espacios @P2 @HU-012", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU012-04", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.12.1; §7.12.2 «0»",
      ajuste: "La UI no deja enviar: «Enviar» queda deshabilitado y se lee «Escribe un mensaje para poder enviarlo.» (el «Escribe un mensaje.» del plan es el 400 MENSAJE_VACIO del backend, que la UI nunca provoca)" });
    const d = leerDatos();
    const { est, page } = await enLaComunidad(abrirContexto, d.cursoA, "chatvacio");
    usuarioProbado(est.correo);
    const posts = [];
    page.on("request", (q) => { if (q.method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(q.url())) posts.push(q.url()); });
    await test.step("Campo vacío: «Enviar» no está disponible", async () => {
      await expect(campo(page)).toHaveValue("");
      await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();
      await expect(page.getByText("Escribe un mensaje para poder enviarlo.")).toBeVisible();
    });
    await test.step("1. Escribir «   » (solo espacios) → «Enviar» sigue sin estar disponible", async () => {
      await escribir(campo(page), "   ");
      await expect(campo(page)).toHaveValue("   ");
      const enviar = page.getByRole("button", { name: "Enviar", exact: true });
      await expect(enviar).toBeDisabled();
      await expect(page.getByText("Escribe un mensaje para poder enviarlo.")).toBeVisible();
      await campo(page).press("Enter");
      await page.waitForTimeout(1000);
      expect(posts, "no se envía nada al servidor").toEqual([]);
    });
  });

  // ------------------------------------------------------------------ CP-HU012-05 (parametrizado)
  for (const n of [1, 1000]) {
    test(`CP-HU012-05 — Mensaje de ${n} caracteres @P2 @HU-012`, async ({ abrirContexto }) => {
      test.setTimeout(10 * 60_000);
      caso({ ...base, prioridad: "P2", caso: "CP-HU012-05", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "E2E-UI",
        referenciaPlan: "§7.12.2", ajuste: n === 1 ? "Mensaje de 1 carácter: «x» (único por la hora de envío en la lista)" : undefined });
      const d = leerDatos();
      const a = await enLaComunidad(abrirContexto, d.cursoA, `chatlen${n}a`);
      const b = await enLaComunidad(abrirContexto, d.cursoA, `chatlen${n}b`);
      usuarioProbado(a.est.correo);
      const texto = n === 1 ? "x" : textoDe(1000);
      expect(texto).toHaveLength(n);
      const deA = (page) => lista(page).getByRole("listitem").filter({ hasText: a.est.nombre })
        .filter({ has: page.getByText(texto, { exact: true }) });
      await test.step(`1. A escribe ${n} carácter(es) → «Enviar»; B lo recibe`, async () => {
        if (n === 1000) await escribirLargo(campo(a.page), texto); else await escribir(campo(a.page), texto);
        await expect(campo(a.page)).toHaveValue(texto);
        const resp = a.page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()));
        await medir(`entrega de ${n} caracteres a otro participante`, [U.ms(500, "HU-012 ≤ 500 ms"), U.s(1, "RF-010 < 1 s")],
          () => a.page.getByRole("button", { name: "Enviar", exact: true }).click(),
          () => expect(deA(b.page)).toHaveCount(1));
        expect((await resp).status()).toBeLessThan(400);
      });
      await test.step("Resultado: se guardó (sigue al recargar, una sola vez y completo)", async () => {
        await b.page.reload();
        await expect(b.page.getByText("Conversación en tiempo real")).toBeVisible();
        await expect(deA(b.page)).toHaveCount(1);
        const visto = (await deA(b.page).getByText(texto, { exact: true }).innerText());
        expect(visto).toHaveLength(n);
      });
    });
  }

  // ------------------------------------------------------------------ CP-HU012-01
  test("CP-HU012-01 — 1001 caracteres: la UI lo previene @P2 @HU-012", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU012-01", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.14; §7.12.1; §7.12.2 (D-10, parte a)" });
    const d = leerDatos();
    const { est, page } = await enLaComunidad(abrirContexto, d.cursoA, "chat1001ui");
    usuarioProbado(est.correo);
    const texto = textoDe(1001);
    await test.step("1. Escribir 1001 caracteres", () => escribirLargo(campo(page), texto));
    await test.step("Resultado: el campo se queda con 1000 (maxLength)", async () => {
      await expect(campo(page)).toHaveAttribute("maxlength", "1000");
      const valor = await campo(page).inputValue();
      expect(valor).toHaveLength(1000);
      expect(valor).toBe(texto.slice(0, 1000));
    });
  });

  // ------------------------------------------------------------------ CP-HU012-09 (API)
  test("CP-HU012-09 — 1001 caracteres: el backend lo rechaza @P2 @HU-012 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU012-09", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.14; §7.12.1 (D-10, parte b)" });
    const d = leerDatos();
    const { est, page } = await enLaComunidad(abrirContexto, d.cursoA, "chat1001api");
    usuarioProbado(est.correo);
    const texto = textoDe(1001);
    await test.step(`1. POST /api/cursos/${d.cursoA.id}/mensajes con 1001 caracteres (canal real: REST) → 400 MENSAJE_LARGO`, async () => {
      const r = await pedir(page, "POST", `/api/cursos/${d.cursoA.id}/mensajes`, { token: await tokenDeSesion(page),
        datos: { contenido: texto, idCliente: `e2e-${Date.now()}` } });
      test.info().annotations.push({ type: "respuesta", description: `${r.status} ${r.cuerpo?.codigo} «${r.cuerpo?.mensaje}»` });
      expect(r.status).toBe(400);
      expect(r.cuerpo?.codigo).toBe("MENSAJE_LARGO");
      expect(r.cuerpo?.mensaje).toBe(MSG_LARGO);
    });
    await test.step("Resultado: el mensaje no aparece en la conversación", async () => {
      await page.reload();
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(lista(page).getByText(texto.slice(0, 20))).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU012-07
  test("CP-HU012-07 — Cola de reenvío activa al perder la conexión @P2 @HU-012", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU012-07", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.3", ajuste: "La desconexión se emula con context.setOffline (decisión 4); la conexión se restaura dentro del caso" });
    const d = leerDatos();
    const a = await enLaComunidad(abrirContexto, d.cursoA, "chatcola");
    const b = await enLaComunidad(abrirContexto, d.cursoA, "chatcolab");
    usuarioProbado(a.est.correo);
    const texto = `Mensaje en cola ${Date.now()}`;
    const ctx = a.page.context();
    try {
      await test.step("1. context.setOffline(true) → enviar: queda en cola", async () => {
        await ctx.setOffline(true);
        await escribir(campo(a.page), texto);
        await a.page.getByRole("button", { name: "Enviar", exact: true }).click();
        await expect(aviso(a.page)).toHaveText(MSG_COLA);
        const enCola = a.page.getByRole("list", { name: "Mensajes en cola" }).getByRole("listitem").filter({ hasText: texto });
        await expect(enCola).toHaveCount(1);
        await expect(enCola.getByText("En cola · se enviará al reconectar", { exact: false })).toBeVisible();
        await expect(campo(a.page)).toHaveValue("");
      });
    } finally {
      await ctx.setOffline(false);
    }
    await test.step("2. Volver a conectar: «Se enviaron los mensajes que estaban en cola.»", async () => {
      const resp = a.page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()), { timeout: 30_000 });
      expect((await resp).status()).toBeLessThan(400);
      await expect(aviso(a.page)).toHaveText(MSG_COLA_VACIADA);
      await expect(a.page.getByRole("list", { name: "Mensajes en cola" })).toHaveCount(0);
    });
    await test.step("Resultado: sin duplicados (A, B y al recargar)", async () => {
      await expect(lista(b.page).getByText(texto, { exact: true })).toHaveCount(1);
      await a.page.waitForTimeout(2000); // margen para un reenvío duplicado; solo se observa
      await expect(lista(a.page).getByText(texto, { exact: true })).toHaveCount(1);
      await expect(lista(b.page).getByText(texto, { exact: true })).toHaveCount(1);
      await a.page.reload();
      await expect(a.page.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(lista(a.page).getByText(texto, { exact: true })).toHaveCount(1);
    });
  });

  // ------------------------------------------------------------------ CP-HU012-08
  test("CP-HU012-08 — Cola de reenvío inactiva @P2 @HU-012", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU012-08", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.3; HU-028 «activar/desactivar cola»",
      ajuste: "Curso propio del caso (instructor y estudiante desechables) para no cambiar la cola del curso del setup; la desconexión se emula con context.setOffline (decisión 4) y se restaura dentro del caso" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "chatins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "chatsincola" });
    usuarioProbado(ins.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Chat", inscritos: [est] });
    await test.step("1. Instructor: Comunidad del curso → desactivar «Cola de reenvío de mensajes»", async () => {
      const pi = await sesion(abrirContexto, ins);
      await pi.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Comunidad", exact: true }).click();
      await pi.getByRole("combobox", { name: "Curso" }).selectOption({ label: curso.titulo });
      await expect(pi).toHaveURL(new RegExp(`/comunidad/${curso.id}$`));
      const sw = pi.getByRole("switch", { name: "Cola de reenvío de mensajes" });
      await expect(sw).toHaveAttribute("aria-checked", "true");
      const resp = pi.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/cursos/${curso.id}/comunidad/configuracion`);
      await sw.click();
      expect((await resp).status()).toBe(200);
      await expect(pi.getByText("Cola de reenvío desactivada: si falla la conexión, el mensaje no se envía y queda en el campo.").first()).toBeVisible();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await pi.context().close();
    });
    const page = await sesion(abrirContexto, est);
    await test.step("Precondición: el estudiante abre la Comunidad del curso", async () => {
      await page.getByRole("link", { name: "Comunidad", exact: true }).click();
      await page.getByRole("combobox", { name: "Curso" }).selectOption({ label: curso.titulo });
      await expect(page).toHaveURL(new RegExp(`/comunidad/${curso.id}$`));
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
    });
    const texto = `Mensaje sin cola ${Date.now()}`;
    const ctx = page.context();
    try {
      await test.step("2. Estudiante sin conexión envía: no se envía y el texto sigue en el campo", async () => {
        await ctx.setOffline(true);
        await escribir(campo(page), texto);
        await page.getByRole("button", { name: "Enviar", exact: true }).click();
        await expect(aviso(page)).toHaveText(MSG_SIN_COLA);
        await expect(campo(page)).toHaveValue(texto);
        await expect(page.getByRole("list", { name: "Mensajes en cola" })).toHaveCount(0);
      });
    } finally {
      await ctx.setOffline(false);
    }
    await test.step("Resultado: al volver la conexión no se envía solo", async () => {
      await page.waitForTimeout(3000);
      await page.reload();
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(lista(page).getByText(texto, { exact: true })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "CHAT_COLA_DESACTIVADA", resultado: "Permitido", usuario: ins.correo, recurso: `cursos/${curso.id}` });
  });
});
