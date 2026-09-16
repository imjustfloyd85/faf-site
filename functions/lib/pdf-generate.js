const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const LINE_HEIGHT = 16;
const HEADING_SIZE = 16;
const BODY_SIZE = 11;
const FOOTER_SIZE = 9;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CHARS_PER_LINE = 80;

function escPdfString(str) {
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

export function generatePdf({ title, sections, footer }) {
  const contentLines = [];

  if (title) {
    contentLines.push({
      text: title,
      bold: true,
      size: HEADING_SIZE,
      spacing: 24,
    });
    contentLines.push({ text: "", size: BODY_SIZE, spacing: 8 });
  }

  for (const section of sections) {
    if (section.heading) {
      contentLines.push({
        text: section.heading,
        bold: true,
        size: 13,
        spacing: 20,
      });
    }
    if (section.text) {
      const wrapped = wrapText(section.text, CHARS_PER_LINE);
      for (const line of wrapped) {
        contentLines.push({
          text: line,
          bold: false,
          size: BODY_SIZE,
          spacing: LINE_HEIGHT,
        });
      }
      contentLines.push({ text: "", size: BODY_SIZE, spacing: 8 });
    }
  }

  const pages = [];
  let currentPage = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;

  for (const line of contentLines) {
    if (y - line.spacing < MARGIN_BOTTOM + 20) {
      pages.push(currentPage);
      currentPage = [];
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
    y -= line.spacing;
    currentPage.push({ ...line, y });
  }
  if (currentPage.length > 0) pages.push(currentPage);
  if (pages.length === 0) pages.push([]);

  const objects = [];
  let nextObjId = 1;

  function addObj(content) {
    const id = nextObjId++;
    objects.push({ id, content });
    return id;
  }

  const catalogId = addObj(null);
  const pagesObjId = addObj(null);

  const fontRegId = addObj(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT} >>`,
  );
  const fontBoldId = addObj(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BOLD} >>`,
  );

  const pageObjIds = [];
  for (const page of pages) {
    const streamLines = [];
    streamLines.push("BT");

    for (const line of page) {
      const font = line.bold ? "F2" : "F1";
      streamLines.push(`/${font} ${line.size} Tf`);
      streamLines.push(`${MARGIN_LEFT} ${line.y} Td`);
      streamLines.push(`(${escPdfString(line.text)}) Tj`);
      streamLines.push("0 0 Td");
    }

    if (footer) {
      streamLines.push(`/F1 ${FOOTER_SIZE} Tf`);
      streamLines.push(`${MARGIN_LEFT} ${MARGIN_BOTTOM - 10} Td`);
      streamLines.push(`(${escPdfString(footer)}) Tj`);
      streamLines.push("0 0 Td");
    }

    streamLines.push("ET");
    const stream = streamLines.join("\n");

    const streamId = addObj(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );

    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Contents ${streamId} 0 R ` +
        `/Resources << /Font << /F1 ${fontRegId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`,
    );
    pageObjIds.push(pageId);
  }

  objects[0].content = `<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`;
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
