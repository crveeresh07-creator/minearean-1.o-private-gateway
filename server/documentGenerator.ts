/**
 * Multi-Format Document Output Generator
 *
 * Generates real downloadable files in:
 * - PDF (.pdf) via pdfkit
 * - DOCX (.docx) via docx
 * - PPTX (.pptx) via pptxgenjs
 * - XLSX (.xlsx) via xlsx
 * - TXT (.txt)
 *
 * Preserves headings, paragraphs, bullet points, and tables.
 */

import fs from 'fs';
import PDFDocument from 'pdfkit';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  BorderStyle,
  ShadingType
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';

const FONT_PATHS = {
  latinRegular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  latinBold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  kannadaRegular: '/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf',
  kannadaBold: '/usr/share/fonts/truetype/noto/NotoSansKannada-Bold.ttf',
  devanagariRegular: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
  devanagariBold: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf'
};

export type OutputFormat = 'pdf' | 'docx' | 'pptx' | 'txt' | 'xlsx';

export interface ExportMetadata {
  originalFilename: string;
  leakCheckStatus: string;
  entitiesMasked: number;
  entityCounts: Record<string, number>;
  llmUsed: string;
  processedAt: string;
}

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function parseBlocks(markdownText: string): Block[] {
  const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i++;
      continue;
    }

    // Markdown Table detection
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const parsedRows = tableLines
        .filter(tl => !/^\|[\s\-:|]+\|$/.test(tl))
        .map(tl =>
          tl
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(c => cleanInlineMarkdown(c))
        );
      if (parsedRows.length > 0) {
        blocks.push({
          type: 'table',
          headers: parsedRows[0],
          rows: parsedRows.slice(1)
        });
      }
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      blocks.push({ type: 'heading', level: 3, text: cleanInlineMarkdown(line.slice(4)) });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'heading', level: 2, text: cleanInlineMarkdown(line.slice(3)) });
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'heading', level: 1, text: cleanInlineMarkdown(line.slice(2)) });
      i++;
      continue;
    }

    // Bullet points
    if (/^[-*•]\s+/.test(line)) {
      blocks.push({ type: 'bullet', text: cleanInlineMarkdown(line.replace(/^[-*•]\s+/, '')) });
      i++;
      continue;
    }

    // Preserve line-by-line breaks inside structured text blocks (e.g., Sanitized Outbound Payload)
    const paraLines = [cleanInlineMarkdown(line)];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*•]\s+/.test(lines[i].trim())
    ) {
      paraLines.push(cleanInlineMarkdown(lines[i].trim()));
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

interface PdfFontMap {
  latin: string;
  latinBold: string;
  kannada: string;
  kannadaBold: string;
  devanagari: string;
  devanagariBold: string;
}

function registerPdfFonts(doc: PDFKit.PDFDocument): PdfFontMap {
  const fonts: PdfFontMap = {
    latin: 'Helvetica',
    latinBold: 'Helvetica-Bold',
    kannada: 'Helvetica',
    kannadaBold: 'Helvetica-Bold',
    devanagari: 'Helvetica',
    devanagariBold: 'Helvetica-Bold'
  };

  if (fs.existsSync(FONT_PATHS.latinRegular)) {
    doc.registerFont('LatinRegular', FONT_PATHS.latinRegular);
    fonts.latin = 'LatinRegular';
    fonts.kannada = 'LatinRegular';
    fonts.devanagari = 'LatinRegular';
  }
  if (fs.existsSync(FONT_PATHS.latinBold)) {
    doc.registerFont('LatinBold', FONT_PATHS.latinBold);
    fonts.latinBold = 'LatinBold';
    fonts.kannadaBold = 'LatinBold';
    fonts.devanagariBold = 'LatinBold';
  }
  if (fs.existsSync(FONT_PATHS.kannadaRegular)) {
    doc.registerFont('KannadaRegular', FONT_PATHS.kannadaRegular);
    fonts.kannada = 'KannadaRegular';
  }
  if (fs.existsSync(FONT_PATHS.kannadaBold)) {
    doc.registerFont('KannadaBold', FONT_PATHS.kannadaBold);
    fonts.kannadaBold = 'KannadaBold';
  }
  if (fs.existsSync(FONT_PATHS.devanagariRegular)) {
    doc.registerFont('DevanagariRegular', FONT_PATHS.devanagariRegular);
    fonts.devanagari = 'DevanagariRegular';
  }
  if (fs.existsSync(FONT_PATHS.devanagariBold)) {
    doc.registerFont('DevanagariBold', FONT_PATHS.devanagariBold);
    fonts.devanagariBold = 'DevanagariBold';
  }

  return fonts;
}

function pickScriptFont(segment: string, fonts: PdfFontMap, bold: boolean): string {
  if (/[\u0C80-\u0CFF]/.test(segment)) {
    return bold ? fonts.kannadaBold : fonts.kannada;
  }
  if (/[\u0900-\u097F]/.test(segment)) {
    return bold ? fonts.devanagariBold : fonts.devanagari;
  }
  return bold ? fonts.latinBold : fonts.latin;
}

function renderUnicodePdfText(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontMap,
  text: string,
  opts: { x: number; width: number; fontSize: number; bold?: boolean; color: string; lineGap?: number; checkPageBreak?: boolean }
) {
  const { x, width, fontSize, bold = false, color, lineGap = 2.5, checkPageBreak = true } = opts;
  const lines = text.split('\n');

  for (const rawLine of lines) {
    if (checkPageBreak && doc.y > doc.page.height - 72) {
      doc.addPage();
    }
    if (!rawLine) {
      doc.moveDown(0.35);
      continue;
    }

    const segments = rawLine.split(/([\u0C80-\u0CFF]+|[\u0900-\u097F]+)/g).filter(Boolean);
    if (segments.length === 0) continue;

    doc.x = x;
    segments.forEach((seg, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === segments.length - 1;
      const fontName = pickScriptFont(seg, fonts, bold);
      doc.font(fontName).fontSize(fontSize).fillColor(color);
      if (isFirst) {
        doc.text(seg, x, doc.y, { width, lineGap, continued: !isLast });
      } else {
        doc.text(seg, { width, lineGap, continued: !isLast });
      }
    });
  }
}

async function generatePdfBuffer(content: string, meta: ExportMetadata): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: {
        Title: `Privacy Gateway - ${meta.originalFilename}`,
        Creator: 'Privacy Gateway DPDP Engine'
      }
    });

    const fonts = registerPdfFonts(doc);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const usableWidth = doc.page.width - 108;

    // Header band
    doc.rect(54, 42, usableWidth, 4).fill('#0F2544');
    doc.y = 56;
    renderUnicodePdfText(doc, fonts, meta.originalFilename, {
      x: 54,
      width: usableWidth,
      fontSize: 16,
      bold: true,
      color: '#0F2544',
      checkPageBreak: false
    });
    renderUnicodePdfText(
      doc,
      fonts,
      `Privacy Gateway Sanitized Payload  |  ${meta.leakCheckStatus}  |  ${meta.entitiesMasked} PII Masked  |  Model: ${meta.llmUsed}`,
      {
        x: 54,
        width: usableWidth,
        fontSize: 8.5,
        bold: false,
        color: '#475569',
        checkPageBreak: false
      }
    );
    doc.moveDown(0.6);
    doc.moveTo(54, doc.y).lineTo(doc.page.width - 54, doc.y).strokeColor('#CBD5E1').lineWidth(0.8).stroke();
    doc.moveDown(0.7);

    const blocks = parseBlocks(content);

    for (const block of blocks) {
      if (doc.y > doc.page.height - 90) {
        doc.addPage();
      }

      if (block.type === 'heading') {
        doc.moveDown(0.35);
        const fontSize = block.level === 1 ? 13.5 : block.level === 2 ? 12 : 10.5;
        renderUnicodePdfText(doc, fonts, block.text, {
          x: 54,
          width: usableWidth,
          fontSize,
          bold: true,
          color: '#0F2544'
        });
        doc.moveDown(0.2);
      } else if (block.type === 'bullet') {
        renderUnicodePdfText(doc, fonts, `•  ${block.text}`, {
          x: 66,
          width: usableWidth - 12,
          fontSize: 10,
          color: '#1E293B',
          lineGap: 2.5
        });
        doc.moveDown(0.15);
      } else if (block.type === 'table') {
        const colCount = Math.max(1, block.headers.length);
        const colWidth = usableWidth / colCount;
        const allRows = [block.headers, ...block.rows];

        allRows.forEach((row, rIdx) => {
          if (doc.y > doc.page.height - 80) {
            doc.addPage();
          }
          const startY = doc.y;
          doc.font(rIdx === 0 ? fonts.latinBold : fonts.latin).fontSize(9);
          const rowHeight = Math.max(
            22,
            ...row.map(cell =>
              doc.heightOfString(cell || ' ', { width: colWidth - 10 }) + 10
            )
          );

          row.forEach((cell, cIdx) => {
            const cellX = 54 + cIdx * colWidth;
            doc
              .rect(cellX, startY, colWidth, rowHeight)
              .fillAndStroke(rIdx === 0 ? '#0F2544' : rIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF', '#CBD5E1');
            doc.y = startY + 5;
            renderUnicodePdfText(doc, fonts, cell || '', {
              x: cellX + 5,
              width: colWidth - 10,
              fontSize: 9,
              bold: rIdx === 0,
              color: rIdx === 0 ? '#FFFFFF' : '#1E293B',
              lineGap: 1.5,
              checkPageBreak: false
            });
          });

          doc.y = startY + rowHeight;
        });
        doc.moveDown(0.5);
      } else {
        renderUnicodePdfText(doc, fonts, block.text, {
          x: 54,
          width: usableWidth,
          fontSize: 10,
          color: '#1E293B',
          lineGap: 2.5
        });
        doc.moveDown(0.4);
      }
    }

    doc.end();
  });
}

async function generateDocxBuffer(content: string, meta: ExportMetadata): Promise<Buffer> {
  const blocks = parseBlocks(content);
  const children: Array<Paragraph | DocxTable> = [
    new Paragraph({
      text: meta.originalFilename,
      heading: HeadingLevel.TITLE
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${meta.leakCheckStatus} • ${meta.entitiesMasked} Sensitive Entities Protected • Model: ${meta.llmUsed}`,
          color: '475569',
          size: 18
        })
      ],
      spacing: { after: 280 }
    })
  ];

  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(
        new Paragraph({
          text: block.text,
          heading:
            block.level === 1
              ? HeadingLevel.HEADING_1
              : block.level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
          spacing: { before: 220, after: 100 }
        })
      );
    } else if (block.type === 'bullet') {
      children.push(
        new Paragraph({
          text: block.text,
          bullet: { level: 0 },
          spacing: { after: 80 }
        })
      );
    } else if (block.type === 'table') {
      const allRows = [block.headers, ...block.rows];
      const docxRows = allRows.map((row, rIdx) =>
        new DocxTableRow({
          children: row.map(
            cell =>
              new DocxTableCell({
                shading: rIdx === 0 ? { type: ShadingType.CLEAR, fill: '0F2544' } : undefined,
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' }
                },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell || '',
                        bold: rIdx === 0,
                        color: rIdx === 0 ? 'FFFFFF' : '1E293B',
                        size: 20
                      })
                    ]
                  })
                ]
              })
          )
        })
      );
      children.push(
        new DocxTable({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: docxRows
        })
      );
      children.push(new Paragraph({ text: '', spacing: { after: 140 } }));
    } else {
      const lines = block.text.split('\n');
      const runs = lines.flatMap((lineText, idx) =>
        idx === 0
          ? [new TextRun({ text: lineText, size: 22, color: '1E293B' })]
          : [new TextRun({ text: lineText, size: 22, color: '1E293B', break: 1 })]
      );
      children.push(
        new Paragraph({
          children: runs,
          spacing: { after: 140 }
        })
      );
    }
  }

  const docxDoc = new DocxDocument({
    sections: [{ properties: {}, children }]
  });

  return await Packer.toBuffer(docxDoc);
}

async function generatePptxBuffer(content: string, meta: ExportMetadata): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = meta.originalFilename;

  // Title Slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: '0F2544' };
  titleSlide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.5, w: 1.1, h: 0.08, fill: { color: 'EA580C' } });
  titleSlide.addText(meta.originalFilename, {
    x: 0.7,
    y: 1.8,
    w: 11.8,
    h: 1.2,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF'
  });
  titleSlide.addText(
    `Privacy Gateway Processed Brief\n${meta.leakCheckStatus}  |  ${meta.entitiesMasked} PII Masked  |  Model: ${meta.llmUsed}`,
    {
      x: 0.7,
      y: 3.3,
      w: 11.8,
      h: 1.0,
      fontSize: 15,
      color: 'CBD5E1'
    }
  );

  // Content Slides
  const blocks = parseBlocks(content);
  let slide = pptx.addSlide();
  let currentHeading = 'Processed Summary';
  let currentItems: string[] = [];

  const flushSlide = () => {
    if (currentItems.length === 0) return;
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: '0F2544' } });
    slide.addText(currentHeading, {
      x: 0.6,
      y: 0.18,
      w: 12.1,
      h: 0.55,
      fontSize: 20,
      bold: true,
      color: 'FFFFFF'
    });
    slide.addText(
      currentItems.map(item => ({ text: item, options: { bullet: true, breakLine: true } })),
      {
        x: 0.6,
        y: 1.25,
        w: 12.1,
        h: 5.7,
        fontSize: 14,
        color: '1E293B',
        valign: 'top',
        paraSpaceAfter: 10
      }
    );
    slide = pptx.addSlide();
    currentItems = [];
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (currentItems.length > 0) flushSlide();
      currentHeading = block.text;
    } else if (block.type === 'table') {
      if (currentItems.length > 0) flushSlide();
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: '0F2544' } });
      slide.addText(currentHeading, {
        x: 0.6,
        y: 0.18,
        w: 12.1,
        h: 0.55,
        fontSize: 20,
        bold: true,
        color: 'FFFFFF'
      });
      const tableData = [
        block.headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: '0F2544' } } })),
        ...block.rows.slice(0, 10).map(r => r.map(c => ({ text: c })))
      ];
      slide.addTable(tableData, {
        x: 0.6,
        y: 1.25,
        w: 12.1,
        fontSize: 11,
        border: { pt: 1, color: 'CBD5E1' }
      });
      slide = pptx.addSlide();
    } else {
      const text = block.text;
      // Split overly long paragraphs so slides remain crisp
      if (currentItems.join('\n').length + text.length > 900 || currentItems.length >= 6) {
        flushSlide();
      }
      currentItems.push(text);
    }
  }

  if (currentItems.length > 0) {
    flushSlide();
  }

  // Remove trailing empty slide if unused
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides = (pptx as any).slides;
  if (Array.isArray(slides) && slides.length > 1 && currentItems.length === 0) {
    // Only pop if last slide has no elements
    const lastSlide = slides[slides.length - 1];
    if (!lastSlide._slideObjects || lastSlide._slideObjects.length === 0) {
      slides.pop();
    }
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(out as ArrayBuffer);
}

function generateXlsxBuffer(content: string, meta: ExportMetadata): Buffer {
  const wb = XLSX.utils.book_new();
  const blocks = parseBlocks(content);

  // Sheet 1: Structured Content & Tables
  const sheetRows: Array<Array<string | number>> = [];
  let hasTable = false;

  for (const block of blocks) {
    if (block.type === 'table') {
      hasTable = true;
      if (sheetRows.length > 0) sheetRows.push([]);
      sheetRows.push(block.headers);
      for (const r of block.rows) {
        sheetRows.push(r);
      }
      sheetRows.push([]);
    } else if (block.type === 'heading') {
      sheetRows.push([block.text]);
    } else {
      // Parse "Key: Value" lines into two columns for clean spreadsheet utility
      for (const subLine of block.text.split('\n')) {
        const trimmedLine = subLine.trim();
        if (!trimmedLine) continue;
        const kvMatch = trimmedLine.match(/^([^:]{2,45}):\s+(.+)$/);
        if (kvMatch) {
          sheetRows.push([kvMatch[1].trim(), kvMatch[2].trim()]);
        } else {
          sheetRows.push([trimmedLine]);
        }
      }
    }
  }

  if (!hasTable && sheetRows.length === 0) {
    sheetRows.push(['Processed Response'], [content]);
  }

  const contentSheet = XLSX.utils.aoa_to_sheet(sheetRows);
  contentSheet['!cols'] = [{ wch: 36 }, { wch: 68 }, { wch: 28 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, contentSheet, 'Processed Output');

  // Sheet 2: Zero-PII Privacy Summary
  const summaryRows: Array<Array<string | number>> = [
    ['Privacy Gateway Export Summary', ''],
    ['Original Document', meta.originalFilename],
    ['Leak Check Result', meta.leakCheckStatus],
    ['Total PII Masked', meta.entitiesMasked],
    ['External LLM Used', meta.llmUsed],
    ['Processed Timestamp', meta.processedAt],
    ['', ''],
    ['Detected PII Category', 'Count'],
    ...Object.entries(meta.entityCounts).map(([cat, count]) => [cat, count])
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 32 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Privacy Summary');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function generateTxtBuffer(content: string, meta: ExportMetadata): Buffer {
  const header = [
    `PRIVACY GATEWAY - PROCESSED OUTPUT`,
    `Document: ${meta.originalFilename}`,
    `Leak Check: ${meta.leakCheckStatus} | Entities Protected: ${meta.entitiesMasked} | LLM: ${meta.llmUsed}`,
    `--------------------------------------------------------------------------------`,
    ``
  ].join('\n');
  return Buffer.from(header + content + '\n', 'utf8');
}

export async function generateOutputFile(
  content: string,
  format: OutputFormat,
  meta: ExportMetadata
): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
  switch (format) {
    case 'pdf':
      return {
        buffer: await generatePdfBuffer(content, meta),
        mimeType: 'application/pdf',
        extension: 'pdf'
      };
    case 'docx':
      return {
        buffer: await generateDocxBuffer(content, meta),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx'
      };
    case 'pptx':
      return {
        buffer: await generatePptxBuffer(content, meta),
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx'
      };
    case 'xlsx':
      return {
        buffer: generateXlsxBuffer(content, meta),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx'
      };
    case 'txt':
    default:
      return {
        buffer: generateTxtBuffer(content, meta),
        mimeType: 'text/plain; charset=utf-8',
        extension: 'txt'
      };
  }
}
