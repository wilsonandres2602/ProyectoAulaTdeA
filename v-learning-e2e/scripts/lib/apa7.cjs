/**
 * apa7.cjs (copia del skill «Tablas y títulos APA 7», con un cambio en runs()) — Helpers para generar Word (.docx) con tablas y títulos en APA 7.ª edición.
 * Fuente tipográfica por defecto: Arial 11 pt (preferencia del usuario; APA 7 la admite).
 *
 * Requiere el paquete npm `docx` (viene preinstalado en el entorno).
 *
 * Marcado en línea dentro de textos (celdas, notas, párrafos):
 *   _texto_     -> cursiva          (p. ej. _p_ < .05, _M_, _SD_)
 *   __texto__   -> negrita
 *   ^a^         -> superíndice      (notas específicas de tabla)
 *   \n          -> nuevo párrafo dentro de una celda
 * Los asteriscos (*) NO tienen significado especial, así que "* p < .05" es seguro.
 */

let docx;
try {
  docx = require('docx');
} catch (e) {
  docx = require(require.resolve('docx', { paths: [process.cwd(), __dirname] }));
}
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header,
  WidthType, AlignmentType, BorderStyle, TableBorders, VerticalAlign,
  HeadingLevel, PageOrientation, PageNumber, TableLayoutType,
} = docx;
const fs = require('fs');

// ---------------------------------------------------------------- constantes
const FONT = 'Arial';
const SIZE = 22; // medios puntos -> 11 pt
const SPACING = { single: 240, one_half: 360, double: 480 };

// Carta (US Letter), márgenes de 1 pulgada (2,54 cm). 1 pulgada = 1440 DXA.
const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - 2 * MARGIN;      // 9360  (vertical)
const LANDSCAPE_CONTENT_W = PAGE_H - 2 * MARGIN; // 12960 (horizontal)
const INDENT = 720; // ½ pulgada = 1,27 cm

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 6, color: '000000' }; // 0,75 pt

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

// -------------------------------------------------------------- texto en línea
// Cambio para v-learning-e2e: un «_» entre letras o dígitos (SIN_RESPUESTA, ERROR_INTERNO) es
// literal y no abre cursiva; se protege antes de partir el texto y se restaura en cada run.
const GUION = '';
const literal = (t) => t.replace(//g, '_');
function runs(text, base = {}) {
  const parts = String(text ?? '')
    .replace(/(?<=[A-Za-z0-9])_(?=[A-Za-z0-9])/g, GUION)
    .split(/(__[^_]+__|_[^_]+_|\^[^^]+\^)/)
    .filter((s) => s !== '');
  return parts.map((p) => {
    const common = { font: FONT, size: SIZE, ...base };
    if (p.startsWith('__') && p.endsWith('__') && p.length > 4)
      return new TextRun({ ...common, text: literal(p.slice(2, -2)), bold: true });
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2)
      return new TextRun({ ...common, text: literal(p.slice(1, -1)), italics: true });
    if (p.startsWith('^') && p.endsWith('^') && p.length > 2)
      return new TextRun({ ...common, text: literal(p.slice(1, -1)), superScript: true });
    return new TextRun({ ...common, text: literal(p) });
  });
}

// ------------------------------------------------------------------- párrafos
/** Párrafo de cuerpo: interlineado doble, sangría de primera línea de ½ pulgada, alineado a la izquierda. */
function para(text, { indent = true, spacing = 'double' } = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: SPACING[spacing], before: 0, after: 0 },
    indent: indent ? { firstLine: INDENT } : undefined,
    children: runs(text),
  });
}

// -------------------------------------------------------------------- títulos
/**
 * Niveles 1–3: títulos independientes (el texto va en un párrafo nuevo).
 *   1: centrado · negrita
 *   2: izquierda · negrita
 *   3: izquierda · negrita cursiva
 * Escribe el texto ya con la capitalización deseada (ver SKILL.md).
 * Sin numeración, sin líneas en blanco antes o después.
 */
function heading(level, text) {
  if (![1, 2, 3].includes(level))
    throw new Error('heading() solo admite niveles 1–3. Para 4 y 5 usa runInHeading().');
  const lv = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
  return new Paragraph({
    heading: lv,
    children: [new TextRun({ text })],
  });
}

/**
 * Niveles 4–5: título "en línea" — sangría de ½ pulgada, punto final y el texto
 * continúa en el MISMO párrafo.
 *   4: negrita
 *   5: negrita cursiva
 */
function runInHeading(level, title, bodyText = '') {
  if (![4, 5].includes(level)) throw new Error('runInHeading() solo admite niveles 4 y 5.');
  const t = /[.!?]$/.test(title.trim()) ? title.trim() : title.trim() + '.';
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: SPACING.double, before: 0, after: 0 },
    indent: { firstLine: INDENT },
    children: [
      new TextRun({ text: t, bold: true, italics: level === 5, font: FONT, size: SIZE }),
      ...(bodyText ? [new TextRun({ text: ' ', font: FONT, size: SIZE }), ...runs(bodyText)] : []),
    ],
  });
}

// --------------------------------------------------------------------- tablas
function scaleWidths(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = weights.map((x) => Math.floor((x / sum) * total));
  w[w.length - 1] += total - w.reduce((a, b) => a + b, 0);
  return w;
}

function makeCell(text, { width, align, top, bottom, isHeader, keepNext, spacing, bold }) {
  const lines = String(text ?? '').split('\n');
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top, bottom, left: NONE, right: NONE },
    verticalAlign: isHeader ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
    children: lines.map(
      (ln) =>
        new Paragraph({
          alignment: ALIGN[align],
          keepNext,
          spacing: { line: SPACING[spacing], before: 0, after: 0 },
          children: runs(ln, bold ? { bold: true } : {}),
        })
    ),
  });
}

/**
 * Devuelve un arreglo de elementos (número, título, tabla, nota) listo para meter en `children`.
 *
 * opts:
 *   number        (obligatorio) número de tabla: 1, 2, ... (o "A1" en apéndices)
 *   title         (obligatorio) título breve y descriptivo (se escribe en cursiva)
 *   headers       (obligatorio) ["Col 1", "Col 2", ...]  — siempre se centran
 *   rows          (obligatorio) [[...], [...]]  — texto con \n para varias líneas por celda
 *   note          nota general/específica (sin la palabra "Nota."; se agrega sola). Opcional.
 *   noteLabel     por defecto "Nota."
 *   columnWidths  pesos relativos, p. ej. [1, 3, 4]. Por defecto, columnas iguales.
 *   width         ancho total en DXA. Por defecto CONTENT_W (vertical). Usa LANDSCAPE_CONTENT_W en horizontal.
 *   bodySpacing   "single" (defecto) | "one_half" | "double"
 *   bodyAlign     "left" | "center" | "right" | arreglo por columna.
 *                 Por defecto: primera columna a la izquierda y las demás centradas.
 *   totalsRows    índices (en `rows`) de filas de totales: llevan línea encima.
 *   keepTogether  mantener la tabla completa en una página (defecto: true si tiene ≤ 15 filas)
 */
function apaTable(opts) {
  const {
    number, title, headers, rows,
    note, noteLabel = 'Nota.',
    columnWidths, width = CONTENT_W,
    bodySpacing = 'single', bodyAlign,
    totalsRows = [],
    keepTogether = rows.length <= 15,
  } = opts;

  if (number == null || !title || !headers || !rows)
    throw new Error('apaTable requiere number, title, headers y rows.');

  const nCols = headers.length;
  rows.forEach((r, i) => {
    if (r.length !== nCols) throw new Error(`La fila ${i} tiene ${r.length} celdas; se esperaban ${nCols}.`);
  });

  const widths = scaleWidths(columnWidths || new Array(nCols).fill(1), width);
  const aligns = Array.isArray(bodyAlign)
    ? bodyAlign
    : bodyAlign
      ? new Array(nCols).fill(bodyAlign)
      : headers.map((_, i) => (i === 0 ? 'left' : 'center'));

  // Número (negrita) y título (cursiva): líneas separadas, interlineado doble, alineados a la izquierda.
  const caption = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      keepNext: true,
      spacing: { line: SPACING.double, before: 0, after: 0 },
      children: [new TextRun({ text: `Tabla ${number}`, bold: true, font: FONT, size: SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      keepNext: true,
      spacing: { line: SPACING.double, before: 0, after: 0 },
      children: runs(title, { italics: true }),
    }),
  ];

  // Bordes: solo horizontales — arriba de la tabla, bajo los encabezados, sobre los totales y al pie.
  const all = [headers, ...rows];
  const lastIdx = all.length - 1;
  const isTotal = (i) => i > 0 && totalsRows.includes(i - 1);
  const bottomLine = (i) => i === 0 || i === lastIdx || isTotal(i + 1);
  const topLine = (i) => i === 0 || isTotal(i) || (i > 0 && bottomLine(i - 1));

  const tableRows = all.map((r, i) => {
    const isHeader = i === 0;
    return new TableRow({
      tableHeader: isHeader, // se repite en cada página si la tabla es larga
      cantSplit: true,
      children: r.map((cellText, c) =>
        makeCell(cellText, {
          width: widths[c],
          align: isHeader ? 'center' : aligns[c],
          top: topLine(i) ? LINE : NONE,
          bottom: bottomLine(i) ? LINE : NONE,
          isHeader,
          keepNext: keepTogether && i < lastIdx,
          spacing: isHeader ? bodySpacing : bodySpacing,
          bold: false,
        })
      ),
    });
  });

  const table = new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: widths,
    // Cambio para v-learning-e2e: diseño fijo para que Word respete los anchos de columna
    // (con autoajuste, las columnas de ID y caso se encogían hasta partir «D-18» letra por letra).
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
    rows: tableRows,
  });

  const out = [...caption, table];

  if (note) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: SPACING.double, before: 0, after: 0 },
        children: [
          new TextRun({ text: noteLabel, italics: true, font: FONT, size: SIZE }),
          new TextRun({ text: ' ', font: FONT, size: SIZE }),
          ...runs(note),
        ],
      })
    );
  } else {
    // Línea en blanco para separar la tabla del texto que sigue.
    out.push(new Paragraph({ spacing: { line: SPACING.single, before: 0, after: 0 }, children: [] }));
  }
  return out;
}

// ------------------------------------------------------------------ documento
/**
 * sections: [{ children: [...], landscape?: boolean }]
 * opts.pageNumber: true para número de página arriba a la derecha (APA). Por defecto false.
 */
function createDocument(sections, { pageNumber = false, title = 'Documento APA 7' } = {}) {
  const headStyle = (id, name, outline, alignment, italics) => ({
    id,
    name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font: FONT, size: SIZE, bold: true, italics, color: '000000' },
    paragraph: {
      alignment,
      keepNext: true,
      spacing: { line: SPACING.double, before: 0, after: 0 },
      outlineLevel: outline,
    },
  });

  return new Document({
    title,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE },
          paragraph: { spacing: { line: SPACING.double, before: 0, after: 0 } },
        },
      },
      paragraphStyles: [
        headStyle('Heading1', 'Heading 1', 0, AlignmentType.CENTER, false),
        headStyle('Heading2', 'Heading 2', 1, AlignmentType.LEFT, false),
        headStyle('Heading3', 'Heading 3', 2, AlignmentType.LEFT, true),
      ],
    },
    sections: sections.map((s) => ({
      properties: {
        page: {
          size: {
            width: PAGE_W,
            height: PAGE_H,
            orientation: s.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: pageNumber
        ? {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE })],
                }),
              ],
            }),
          }
        : undefined,
      children: s.children,
    })),
  });
}

async function save(doc, path) {
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path, buf);
  return path;
}

module.exports = {
  FONT, SIZE, SPACING, CONTENT_W, LANDSCAPE_CONTENT_W,
  runs, para, heading, runInHeading, apaTable, createDocument, save,
};
