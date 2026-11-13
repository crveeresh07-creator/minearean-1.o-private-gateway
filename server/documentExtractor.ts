/**
 * Multi-Format Document Extraction Engine
 *
 * Supports:
 * - PDF (.pdf) via pdfjs-dist with coordinate-aware reading order reconstruction
 * - Word (.docx via mammoth + table/heading preservation, .doc via word-extractor)
 * - PowerPoint (.pptx via jszip XML slide extraction, .ppt binary text fallback)
 * - Excel (.xlsx, .xls via SheetJS preserving sheet tabs and tabular grids)
 * - Plain Text (.txt)
 * - Images (.jpg, .jpeg, .png) via local Tesseract.js OCR
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { createWorker } from 'tesseract.js';
import zlib from 'zlib';

export interface ExtractionResult {
  filename: string;
  format: string;
  page_count: number;
  total_chars: number;
  total_words: number;
  scanned_pages: number;
  ocr_used: boolean;
  text: string;
  status: 'success';
}

const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'
]);

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isSupportedFormat(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(filename));
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

function htmlToStructuredText(html: string): string {
  let out = html;
  // Headings -> Markdown-style headings
  out = out.replace(/<h1[^>]*>(.*?)<\/h1>/gis, (_, inner) => `\n# ${stripTags(inner)}\n`);
  out = out.replace(/<h2[^>]*>(.*?)<\/h2>/gis, (_, inner) => `\n## ${stripTags(inner)}\n`);
  out = out.replace(/<h[3-6][^>]*>(.*?)<\/h[3-6]>/gis, (_, inner) => `\n### ${stripTags(inner)}\n`);

  // Tables -> pipe-delimited rows
  out = out.replace(/<table[^>]*>(.*?)<\/table>/gis, (_, tableBody) => {
    const rows: string[] = [];
    const trMatches = tableBody.match(/<tr[^>]*>.*?<\/tr>/gis) || [];
    trMatches.forEach((tr: string, idx: number) => {
      const cells = (tr.match(/<t[dh][^>]*>.*?<\/t[dh]>/gis) || []).map((cell: string) =>
        stripTags(cell).replace(/\s+/g, ' ').trim()
      );
      if (cells.length > 0) {
        rows.push(`| ${cells.join(' | ')} |`);
        if (idx === 0) {
          rows.push(`| ${cells.map(() => '---').join(' | ')} |`);
        }
      }
    });
    return `\n${rows.join('\n')}\n`;
  });

  // List items -> bullet points
  out = out.replace(/<li[^>]*>(.*?)<\/li>/gis, (_, inner) => `\n- ${stripTags(inner)}`);
  // Paragraphs & breaks
  out = out.replace(/<\/p>/gi, '\n\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = stripTags(out);

  return decodeXmlEntities(out)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

async function extractPdf(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  if (!buffer.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
    throw new Error(`Invalid or corrupted PDF file '${filename}': missing %PDF header signature.`);
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  if (numPages === 0) {
    throw new Error(`PDF '${filename}' contains 0 pages.`);
  }

  const pageBlocks: string[] = [];
  let scannedPages = 0;

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();

    // Group items by approximate Y coordinate (line reconstruction) to preserve tables and reading order
    const linesMap = new Map<number, Array<{ x: number; text: string }>>();
    for (const rawItem of textContent.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = rawItem as any;
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round((item.transform?.[5] ?? 0) / 3) * 3;
      const x = item.transform?.[4] ?? 0;
      const bucket = linesMap.get(y) || [];
      bucket.push({ x, text: item.str });
      linesMap.set(y, bucket);
    }

    // Sort top-to-bottom (higher Y is higher on PDF page), then left-to-right (lower X first)
    const sortedYs = Array.from(linesMap.keys()).sort((a, b) => b - a);
    const lines: string[] = [];
    for (const y of sortedYs) {
      const items = linesMap.get(y)!.sort((a, b) => a.x - b.x);
      // Join with space or separator if wide column gap exists
      let lineStr = '';
      let prevX = -Infinity;
      for (const it of items) {
        if (prevX !== -Infinity && it.x - prevX > 120) {
          lineStr += '   ';
        } else if (lineStr.length > 0 && !lineStr.endsWith(' ') && !it.text.startsWith(' ')) {
          lineStr += ' ';
        }
        lineStr += it.text;
        prevX = it.x + it.text.length * 4;
      }
      if (lineStr.trim()) lines.push(lineStr.trim());
    }

    const pageText = lines.join('\n').trim();
    if (pageText.replace(/\s+/g, '').length < 20) {
      scannedPages++;
    }
    pageBlocks.push(numPages > 1 ? `--- Page ${i} of ${numPages} ---\n${pageText}` : pageText);
  }

  const fullText = pageBlocks.join('\n\n').trim();
  if (!fullText) {
    throw new Error(
      `PDF '${filename}' appears to be an image-only scan with no selectable text layer. Please upload a PNG/JPG page scan for OCR or a text-based PDF.`
    );
  }

  return {
    filename,
    format: 'pdf',
    page_count: numPages,
    total_chars: fullText.length,
    total_words: fullText.split(/\s+/).filter(Boolean).length,
    scanned_pages: scannedPages,
    ocr_used: false,
    text: fullText,
    status: 'success'
  };
}

async function extractDocx(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const structured = htmlToStructuredText(htmlResult.value);
    if (structured.trim().length > 0) {
      return {
        filename,
        format: 'docx',
        page_count: 1,
        total_chars: structured.length,
        total_words: structured.split(/\s+/).filter(Boolean).length,
        scanned_pages: 0,
        ocr_used: false,
        text: structured,
        status: 'success'
      };
    }
  } catch {
    // Fallback to raw ZIP XML extraction if mammoth fails on unusual DOCX variants
  }

  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    throw new Error(`Invalid or corrupted DOCX file '${filename}': missing word/document.xml.`);
  }
  const text = decodeXmlEntities(
    docXml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();

  if (!text) {
    throw new Error(`DOCX file '${filename}' contains no readable text.`);
  }

  return {
    filename,
    format: 'docx',
    page_count: 1,
    total_chars: text.length,
    total_words: text.split(/\s+/).filter(Boolean).length,
    scanned_pages: 0,
    ocr_used: false,
    text,
    status: 'success'
  };
}

async function extractDoc(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  try {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const parts = [doc.getHeaders(), doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
      .map(s => (s || '').trim())
      .filter(Boolean);
    const text = parts.join('\n\n').trim();
    if (!text) {
      throw new Error(`Legacy DOC file '${filename}' yielded no readable text.`);
    }
    return {
      filename,
      format: 'doc',
      page_count: 1,
      total_chars: text.length,
      total_words: text.split(/\s+/).filter(Boolean).length,
      scanned_pages: 0,
      ocr_used: false,
      text,
      status: 'success'
    };
  } catch (err) {
    throw new Error(`Failed to extract legacy .doc file '${filename}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function extractPptx(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error(`Invalid or corrupted PPTX file '${filename}'.`);
  }

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    throw new Error(`PPTX file '${filename}' contains no readable slides.`);
  }

  const slideTexts: string[] = [];
  for (let idx = 0; idx < slideFiles.length; idx++) {
    const xml = await zip.file(slideFiles[idx])!.async('string');

    // Extract tables (<a:tbl>) and paragraphs (<a:p>)
    const paragraphs: string[] = [];
    const pMatches = xml.match(/<a:p\b[^>]*>.*?<\/a:p>/gs) || [];
    for (const p of pMatches) {
      const tMatches = p.match(/<a:t[^>]*>(.*?)<\/a:t>/gs) || [];
      const line = tMatches.map(t => decodeXmlEntities(stripTags(t))).join('').trim();
      if (line) paragraphs.push(line);
    }

    const slideContent = paragraphs.join('\n').trim();
    if (slideContent) {
      slideTexts.push(`## Slide ${idx + 1}\n${slideContent}`);
    }
  }

  const fullText = slideTexts.join('\n\n').trim();
  if (!fullText) {
    throw new Error(`PPTX file '${filename}' contains no extractable text.`);
  }

  return {
    filename,
    format: 'pptx',
    page_count: slideFiles.length,
    total_chars: fullText.length,
    total_words: fullText.split(/\s+/).filter(Boolean).length,
    scanned_pages: 0,
    ocr_used: false,
    text: fullText,
    status: 'success'
  };
}

async function extractPptLegacy(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  // Check if ZIP-based PPTX misnamed as .ppt
  if (buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    return extractPptx(buffer, filename);
  }
  // Best-effort UTF-16LE / ASCII text stream extraction from legacy OLE .ppt binary
  const utf16Text = buffer.toString('utf16le');
  const asciiMatches = utf16Text.match(/[A-Za-z0-9\s.,:;@+\-\/()]{12,}/g) || [];
  const filtered = asciiMatches
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => /[a-zA-Z]{3,}/.test(s) && !/Microsoft|PowerPoint|Root Entry|Arial|Calibri|Times New Roman/i.test(s));

  const text = Array.from(new Set(filtered)).join('\n').trim();
  if (text.length < 20) {
    throw new Error(`Legacy binary .ppt file '${filename}' could not be parsed cleanly. Please save as .pptx or .pdf and retry.`);
  }

  return {
    filename,
    format: 'ppt',
    page_count: 1,
    total_chars: text.length,
    total_words: text.split(/\s+/).filter(Boolean).length,
    scanned_pages: 0,
    ocr_used: false,
    text,
    status: 'success'
  };
}

function extractSpreadsheet(buffer: Buffer, filename: string, format: 'xls' | 'xlsx'): ExtractionResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new Error(`Corrupted spreadsheet '${filename}': ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!workbook.SheetNames.length) {
    throw new Error(`Spreadsheet '${filename}' contains no worksheets.`);
  }

  const sheetBlocks: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const nonEmptyRows = rows.filter(r => Array.isArray(r) && r.some(cell => String(cell).trim() !== ''));
    if (nonEmptyRows.length === 0) continue;

    const formattedRows = nonEmptyRows.map(row =>
      row.map(cell => String(cell ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()).join(' | ')
    );

    const headerLine = `| ${formattedRows[0]} |`;
    const colCount = nonEmptyRows[0].length;
    const sepLine = `| ${Array(colCount).fill('---').join(' | ')} |`;
    const bodyLines = formattedRows.slice(1).map(r => `| ${r} |`);

    sheetBlocks.push(`## Sheet: ${sheetName}\n${[headerLine, sepLine, ...bodyLines].join('\n')}`);
  }

  const fullText = sheetBlocks.join('\n\n').trim();
  if (!fullText) {
    throw new Error(`Spreadsheet '${filename}' contains no readable cell data.`);
  }

  return {
    filename,
    format,
    page_count: workbook.SheetNames.length,
    total_chars: fullText.length,
    total_words: fullText.split(/\s+/).filter(Boolean).length,
    scanned_pages: 0,
    ocr_used: false,
    text: fullText,
    status: 'success'
  };
}

async function extractImageOCR(buffer: Buffer, filename: string, format: string): Promise<ExtractionResult> {
  // Check basic image headers (PNG or JPEG)
  const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpg) {
    throw new Error(`Invalid or corrupted image file '${filename}'. Expected valid PNG or JPEG header.`);
  }

  let worker;
  try {
    worker = await createWorker('eng');
    const { data } = await worker.recognize(buffer);
    const text = (data?.text || '').trim();
    if (!text) {
      throw new Error(`OCR completed on '${filename}' but no readable text was found in the image.`);
    }
    return {
      filename,
      format,
      page_count: 1,
      total_chars: text.length,
      total_words: text.split(/\s+/).filter(Boolean).length,
      scanned_pages: 1,
      ocr_used: true,
      text,
      status: 'success'
    };
  } catch (err) {
    throw new Error(`OCR extraction failed for '${filename}': ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export async function extractDocumentBuffer(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error(`Uploaded file '${filename}' is empty (0 bytes).`);
  }

  const ext = getExtension(filename);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file format '.${ext || 'unknown'}' for '${filename}'. Supported formats: PDF, DOC, DOCX, PPT, PPTX, TXT, XLS, XLSX, JPG, JPEG, PNG.`
    );
  }

  switch (ext) {
    case 'pdf':
      return await extractPdf(buffer, filename);
    case 'docx':
      return await extractDocx(buffer, filename);
    case 'doc':
      return await extractDoc(buffer, filename);
    case 'pptx':
      return await extractPptx(buffer, filename);
    case 'ppt':
      return await extractPptLegacy(buffer, filename);
    case 'xlsx':
    case 'xls':
      return extractSpreadsheet(buffer, filename, ext);
    case 'jpg':
    case 'jpeg':
    case 'png':
      return await extractImageOCR(buffer, filename, ext);
    case 'txt': {
      // Detect accidental binary disguised as .txt
      if (buffer.subarray(0, 4).includes(0x00)) {
        throw new Error(`File '${filename}' appears to contain binary data rather than UTF-8 plain text.`);
      }
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
      if (!text) {
        throw new Error(`Text file '${filename}' is empty.`);
      }
      return {
        filename,
        format: 'txt',
        page_count: 1,
        total_chars: text.length,
        total_words: text.split(/\s+/).filter(Boolean).length,
        scanned_pages: 0,
        ocr_used: false,
        text,
        status: 'success'
      };
    }
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

// Keep unused zlib import check clean
void zlib;
