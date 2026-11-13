import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function createKannadaUnicodePdf() {
  const text = `ಕರ್ನಾಟಕ ಬ್ಯಾಂಕ್ ನಿಯಮಿತ / KARNATAKA BANK LTD
ದಾವಣಗೆರೆ ಶಾಖೆ / Davanagere Branch
ಖಾತೆ ವಿವರಗಳು / Bank Account Statement

ಗ್ರಾಹಕರ ವಿವರಗಳು / Customer Particulars:
ಹೆಸರು / Name: ರಮೇಶ್ ಕುಮಾರ್ (Ramesh Kumar)
ಖಾತೆ ಸಂಖ್ಯೆ / Account No: 987654321098
IFSC ಕೋಡ್ / IFSC Code: KARB0001234
ಮೊಬೈಲ್ ಸಂಖ್ಯೆ / Mobile No: 9876501234
ಸ್ಥಳ / Place: ದಾವಣಗೆರೆ (Davanagere - 577002)
ಪ್ಯಾನ್ / PAN: ABCDE1234F
ಆಧಾರ್ / Aadhaar: 4321 8765 2109

ಖಾತೆಯ ಪ್ರಕಾರ: ಉಳಿತಾಯ ಖಾತೆ (Savings Bank Account)
ಡಿಜಿಟಲ್ ವೈಯಕ್ತಿಕ ಡೇಟಾ ಸಂರಕ್ಷಣಾ ಕಾಯ್ದೆ (DPDP Act 2023) ಅಡಿಯಲ್ಲಿ ಈ ಮಾಹಿತಿಯನ್ನು ಗೌಪ್ಯವಾಗಿಡಲಾಗಿದೆ.`;

  // Build a unique char set
  const uniqueChars = Array.from(new Set(Array.from(text)));
  const charToCid = new Map();
  const cidToChar = new Map();

  uniqueChars.forEach((ch, idx) => {
    const cid = idx + 1;
    charToCid.set(ch, cid);
    cidToChar.set(cid, ch);
  });

  // Build ToUnicode CMap
  let bfchar = `${uniqueChars.length} beginbfchar\n`;
  for (const [cid, ch] of cidToChar.entries()) {
    const cidHex = cid.toString(16).padStart(4, '0').toUpperCase();
    const utf16Hex = Array.from(ch)
      .map(c => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
      .join('');
    bfchar += `<${cidHex}> <${utf16Hex}>\n`;
  }
  bfchar += `endbfchar\n`;

  const cmapContent = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo <<
  /Registry (Adobe)
  /Ordering (UCS)
  /Supplement 0
>> def
/CMapName /Custom-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${bfchar}endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

  // Generate text stream using hex strings with /Identity-H
  const lines = text.split('\n');
  let streamBody = `BT\n/F1 12 Tf\n40 750 Td\n16 TL\n`;
  for (const line of lines) {
    let hexLine = '';
    for (const ch of Array.from(line)) {
      const cid = charToCid.get(ch);
      hexLine += cid.toString(16).padStart(4, '0');
    }
    streamBody += `<${hexLine}> '\n`;
  }
  streamBody += `ET\n`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  function addObj(c) {
    offsets.push(pdf.length);
    pdf += c + "\n";
  }

  // 1: Catalog
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  // 2: Pages
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  // 3: Page
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj");
  // 4: Content stream
  addObj(`4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}endstream\nendobj`);
  // 5: Type0 Font
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /KannadaUnicode /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj");
  // 6: CIDFont
  addObj("6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KannadaUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [1 1000 1000] >>\nendobj");
  // 7: ToUnicode stream
  addObj(`7 0 obj\n<< /Length ${Buffer.byteLength(cmapContent, 'utf8')} >>\nstream\n${cmapContent}endstream\nendobj`);
  // 8: FontDescriptor
  addObj("8 0 obj\n<< /Type /FontDescriptor /FontName /KannadaUnicode /Flags 4 /FontBBox [-200 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>\nendobj");

  const xrefOffset = pdf.length;
  pdf += `xref\n0 9\n0000000000 65535 f \n`;
  for (let i = 0; i < 8; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  fs.writeFileSync("dummy_kannada_bank_details.pdf", Buffer.from(pdf, "utf8"));
  console.log("Successfully generated dummy_kannada_bank_details.pdf, size:", fs.statSync("dummy_kannada_bank_details.pdf").size);
}

createKannadaUnicodePdf();

async function testExtract() {
  const buf = fs.readFileSync("dummy_kannada_bank_details.pdf");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  const extracted = textContent.items.map(it => it.str).join(' ');
  console.log("EXTRACTED TEXT:\n" + extracted);
}

testExtract();
