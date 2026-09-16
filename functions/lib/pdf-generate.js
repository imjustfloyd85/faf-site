// Zero-dependency PDF generator for Cloudflare Workers runtime.
// Produces valid PDF 1.4 using Helvetica (built into every PDF reader).
// No font embedding, no npm packages -- raw PDF syntax only.

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const LINE_HEIGHT_BODY = 14;
const LINE_HEIGHT_HEADING = 22;
const FONT_SIZE_BODY = 10;
const FONT_SIZE_HEADING = 14;
const FONT_SIZE_TITLE = 20;
const FONT_SIZE_FOOTER = 8;
const CHARS_PER_LINE = 80;

function escPdfStr(str) {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(text, maxChars) {
  const lines = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > maxChars && current.length > 0) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function buildPageStreams(title, sections, footer) {
  const pages = [];
  let currentLines = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;

  function flushPage() {
    pages.push(currentLines.slice());
    currentLines = [];
    y = PAGE_HEIGHT - MARGIN_TOP;
  }

  function addLine(text, fontSize, fontKey, extraSpaceBefore) {
    const lineHeight =
      fontSize >= FONT_SIZE_HEADING ? LINE_HEIGHT_HEADING : LINE_HEIGHT_BODY;
    const spaceBefore = extraSpaceBefore || 0;
    if (y - lineHeight - spaceBefore < MARGIN_BOTTOM + 20) {
      flushPage();
    }
    y -= spaceBefore;
    y -= lineHeight;
    currentLines.push({ text, fontSize, fontKey, x: MARGIN_LEFT, y });
  }

  addLine(title, FONT_SIZE_TITLE, "/F1", 0);
  y -= 10;

  for (const section of sections) {
    if (section.heading) {
      addLine(section.heading, FONT_SIZE_HEADING, "/F1", 16);
      y -= 4;
    }
    if (section.text) {
      const lines = wrapText(section.text, CHARS_PER_LINE);
      for (const line of lines) {
        if (line === "") {
          y -= LINE_HEIGHT_BODY * 0.6;
          if (y < MARGIN_BOTTOM + 20) flushPage();
        } else {
          addLine(line, FONT_SIZE_BODY, "/F2", 0);
        }
      }
    }
  }

  if (currentLines.length > 0) {
    flushPage();
  }

  if (footer) {
    const lastPage = pages[pages.length - 1];
    lastPage.push({
      text: footer,
      fontSize: FONT_SIZE_FOOTER,
      fontKey: "/F2",
      x: MARGIN_LEFT,
      y: MARGIN_BOTTOM - 10,
    });
  }

  return pages;
}

function streamForPage(lines) {
  let s = "";
  for (const line of lines) {
    s += `BT\n${line.fontKey} ${line.fontSize} Tf\n${line.x} ${line.y} Td\n(${escPdfStr(line.text)}) Tj\nET\n`;
  }
  return s;
}

export function generatePdf({ title, sections, footer }) {
  const pageData = buildPageStreams(
    title || "Document",
    sections || [],
    footer,
  );
  if (pageData.length === 0) {
    pageData.push([
      {
        text: title || "Document",
        fontSize: FONT_SIZE_TITLE,
        fontKey: "/F1",
        x: MARGIN_LEFT,
        y: PAGE_HEIGHT - MARGIN_TOP,
      },
    ]);
  }

  const objects = [];
  let nextObj = 1;

  function addObj(content) {
    const id = nextObj++;
    objects.push({ id, content });
    return id;
  }

  const catalogId = addObj(null);
  const pagesId = addObj(null);

  // F1 = Helvetica-Bold, F2 = Helvetica
  const fontBoldId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );
  const fontId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );

  const resourcesDict = `<< /Font << /F1 ${fontBoldId} 0 R /F2 ${fontId} 0 R >> >>`;

  const pageObjIds = [];
  for (const lines of pageData) {
    const stream = streamForPage(lines);
    const streamBytes = new TextEncoder().encode(stream);
    const streamId = addObj(
      `<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`,
    );
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${streamId} 0 R /Resources ${resourcesDict} >>`,
    );
    pageObjIds.push(pageId);
  }

  objects[0].content = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1].content = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += "xref\n";
  pdf += `0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  }

  pdf += "trailer\n";
  pdf += `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += "startxref\n";
  pdf += `${xrefOffset}\n`;
  pdf += "%%EOF\n";

  return new TextEncoder().encode(pdf);
}
