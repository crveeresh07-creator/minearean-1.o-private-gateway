import fs from 'fs';
import zlib from 'zlib';

// Helper to create a PDF with Type0 font and ToUnicode CMap
function createUnicodePdf(outputPath, text) {
  const uniqueChars = Array.from(new Set(Array.from(text)));
  const charToCid = new Map();
  const cidToChar = new Map();

  uniqueChars.forEach((ch, idx) => {
    const cid = idx + 1;
    charToCid.set(ch, cid);
    cidToChar.set(cid, ch);
  });

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

  const lines = text.split('\n');
  let streamBody = `BT\n/F1 12 Tf\n40 750 Td\n18 TL\n`;
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

  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj");
  addObj(`4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}endstream\nendobj`);
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /UnicodeFont /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj");
  addObj("6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /UnicodeFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [1 1000 1000] >>\nendobj");
  addObj(`7 0 obj\n<< /Length ${Buffer.byteLength(cmapContent, 'utf8')} >>\nstream\n${cmapContent}endstream\nendobj`);
  addObj("8 0 obj\n<< /Type /FontDescriptor /FontName /UnicodeFont /Flags 4 /FontBBox [-200 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>\nendobj");

  const xrefOffset = pdf.length;
  pdf += `xref\n0 9\n0000000000 65535 f \n`;
  for (let i = 0; i < 8; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  fs.writeFileSync(outputPath, Buffer.from(pdf, 'utf8'));
  console.log(`Created PDF: ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
}

// Helper to create a valid minimal .docx file (ZIP containing word/document.xml)
function createDocx(outputPath, paragraphs) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs.map(p => `    <w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`).join('\n')}
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  // Create ZIP archive manually
  const files = [
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(docXml, 'utf8') }
  ];

  const localHeaders = [];
  const centralDirs = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const compData = zlib.deflateRawSync(file.content);
    const crc = crc32(file.content);

    // Local file header (30 bytes + name + compData)
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // Local header signature
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // compression method (deflate)
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(crc, 14); // crc32
    lh.writeUInt32LE(compData.length, 18); // comp size
    lh.writeUInt32LE(file.content.length, 22); // uncomp size
    lh.writeUInt16LE(nameBuf.length, 26); // name length
    lh.writeUInt16LE(0, 28); // extra length
    nameBuf.copy(lh, 30);

    localHeaders.push(lh, compData);

    // Central directory header (46 bytes + name)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(file.content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42); // offset of local header
    nameBuf.copy(cd, 46);

    centralDirs.push(cd);
    offset += lh.length + compData.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const cd of centralDirs) cdSize += cd.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...localHeaders, ...centralDirs, eocd]);
  fs.writeFileSync(outputPath, finalZip);
  console.log(`Created DOCX: ${outputPath} (${finalZip.length} bytes)`);
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (~crc) >>> 0;
}

// 1. Test 1 & 5: Kannada PDF
const kannadaText = `ಕರ್ನಾಟಕ ಬ್ಯಾಂಕ್ ನಿಯಮಿತ / KARNATAKA BANK LTD
ದಾವಣಗೆರೆ ಶಾಖೆ (Davanagere Branch - 577002)
ಖಾತೆದಾರರ ಹೆಸರು / Name: ರಮೇಶ್ ಕುಮಾರ್ (Ramesh Kumar)
ಉಳಿತಾಯ ಖಾತೆ ಸಂಖ್ಯೆ / Account No: 987654321098
IFSC ಕೋಡ್ / IFSC Code: KARB0001234
ನೋಂದಾಯಿತ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ / Mobile: 9876501234
ಪ್ಯಾನ್ ಕಾರ್ಡ್ / PAN Number: ABCDE1234F
ಡಿಜಿಟಲ್ ಆಧಾರ್ ಸಂಖ್ಯೆ / Aadhaar: 4321 8765 2109`;
createUnicodePdf("kannada_bank_details_8_lines.pdf", kannadaText);

// 2. Test 2: English Notice PDF
const englishText = `FOOD SAFETY AND STANDARDS AUTHORITY OF INDIA
Statutory Inspection Notice - Section 31
Subject Enterprise: Apex Organics Foods Private Limited
Director: Dr. Rajesh Sharma
Corporate ID: U15400DL2018PTC123456
Registered GSTIN: 07AAAAA0000A1Z5
Official Email: compliance.officer@apexorganics.in
Contact Mobile: 9811223344
Notice Ref: FSSAI/NZ/2026/0892 - New Delhi 110001`;
createUnicodePdf("english_statutory_notice.pdf", englishText);

// 3. Test 3: Hindi PDF
const hindiText = `आयकर विभाग - भारत सरकार (Income Tax Department)
कर निर्धारण वर्ष 2025-2026 मूल्यांकन आदेश
करदाता का नाम: सुरेश कुमार शर्मा (Suresh Kumar Sharma)
स्थाई खाता संख्या (PAN): BCDPM8765K
आधार संख्या: 5432 9876 1234
मोबाइल नंबर: 9823012345
बैंक खाता संख्या: 112233445566, IFSC: SBIN0001234
स्थान: जयपुर, राजस्थान - 302017`;
createUnicodePdf("hindi_tax_assessment.pdf", hindiText);

// 4. Test 4: DOCX Document
createDocx("enterprise_compliance_audit.docx", [
  "ENTERPRISE DATA PROCESSING AGREEMENT (DPDP ACT 2023 COMPLIANT)",
  "Data Principal: Smt. Priya Narayanan",
  "Designated Aadhaar ID: 6789 1234 5678",
  "PAN Number: FGHIJ5678L",
  "Contact Telephone: 9845012345",
  "Settlement Bank Account: 554433221100, IFSC: HDFC0000123",
  "Location: Bengaluru, Karnataka - 560001",
  "Data Fiduciary: CloudSecure Systems India Pvt Ltd"
]);

console.log("All 4 test documents successfully generated!");
