// Uso (desde la raíz del repo):
//   git ls-files --others --exclude-standard "evidencias/*.png" > lista.txt
//   node scripts/detectar-otp.cjs . evidencias/19914cdc-1c70-4e24-9a17-e86ef2e18e09/CP-HU002-14/1-test-finished-1.png lista.txt
// Compara la zona del título «Revisa tu código» (399,130 → 709,178) de cada PNG con la referencia y
// lista las que coinciden: son pantallas del OTP que hay que revisar antes de versionarlas.
// Opcional, 4.º argumento «x,y,ancho,alto»: otra zona del título (p. ej. los fotogramas 1920×1080 del
// video demostrativo; scripts/video-demo.cjs pasa la caja de «Revisa tu código» que midió la demo).
const path = require("path");
const fs = require("fs");
const repo = path.resolve(process.argv[2]);
const { chromium } = require(path.join(repo, "node_modules", "@playwright/test"));
const ref = process.argv[3];
const lista = fs.readFileSync(process.argv[4], "utf8").split(/\r?\n/).filter(Boolean);
const ZONA = (process.argv[5] ?? "399,130,310,48").split(",").map(Number);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent("<canvas id=c></canvas>");
  const datos = async (archivo) => p.evaluate(async ([b64, [zx, zy, zw, zh]]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.getElementById("c");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    if (img.width < zx + zw || img.height < zy + zh) return null;
    const d = x.getImageData(zx, zy, zw, zh).data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push((d[i] + d[i + 1] + d[i + 2]) / 3);
    return g;
  }, [fs.readFileSync(path.resolve(repo, archivo)).toString("base64"), ZONA]);
  const r = await datos(ref);
  for (const f of lista) {
    const g = await datos(f);
    if (!g) continue;
    let s = 0;
    for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - r[i]);
    const dif = s / g.length;
    if (dif < 8) console.log(dif.toFixed(2), f);
  }
  await b.close();
})();
