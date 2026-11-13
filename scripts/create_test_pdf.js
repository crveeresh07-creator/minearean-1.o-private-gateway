import fs from 'fs';

function generateTestPdf() {
  const pages = [
    "FOOD SAFETY AND STANDARDS AUTHORITY OF INDIA (FSSAI)\nStatutory Notice Ref: FSSAI/RO-BLR/2026/INSP-8492\nLicense Number: 21224208000866\nAddressed to: Mr. Rajesh Kumar Sharma, Apex Foods Bengaluru.\nContact: +91 98450 12345, rajesh.sharma@apexfoods.in",
    "ESTABLISHMENT PARTICULARS:\nCorporate: Apex Food Processing Pvt Ltd\nPAN: ABCDE1234F\nGSTIN: 29ABCDE1234F1Z5\nAddress: Plot 42-B Peenya 2nd Stage, Bengaluru - 560058\nContact: Ms. Priya Venkataraman, Mobile: +91 98860 54321",
    "DEFICIENCIES & MANDATORY RECTIFICATION SCHEDULE:\nInspection of Cold Storage Block-3 revealed temperature log gaps.\nStatutory fee of Rs. 25,000 to be deposited to Escrow Account: 987654321098, State Bank of India, IFSC: SBIN0001234.",
    "VERIFICATION & STATUTORY ATTESTATION:\nAll personal data processed under Section 7 of DPDP Act 2023.\nAuthorized Food Safety Officer: Mr. Arun Kumar Hegde (Aadhaar: 5432 9876 1234).\nIssued by: Dr. Suresh Nair, IAS (Aadhaar: 8765 4321 9876, Passport: J8765432)."
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  function addObj(content) {
    offsets.push(pdf.length);
    pdf += content + "\n";
  }

  // 1: Catalog
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  // 2: Pages
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>\nendobj");
  // Font
  const fontObj = "11 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj";

  // Create 4 pages (objects 3, 5, 7, 9) and their streams (4, 6, 8, 10)
  pages.forEach((pageText, idx) => {
    const pageObjNum = 3 + idx * 2;
    const contentObjNum = pageObjNum + 1;
    
    // Page obj
    addObj(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 11 0 R >> >> >>\nendobj`);
    
    const lines = pageText.split("\n");
    let streamBody = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
    for (const line of lines) {
      const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      streamBody += `(${escaped}) '\n`;
    }
    streamBody += "ET\n";

    addObj(`${contentObjNum} 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream\nendobj`);
  });

  // Add Font obj
  addObj(fontObj);

  // Xref
  const xrefOffset = pdf.length;
  pdf += "xref\n0 12\n0000000000 65535 f \n";
  for (let i = 0; i < 11; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size 12 /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";

  fs.writeFileSync("21224208000866.pdf", Buffer.from(pdf, "binary"));
  console.log("Created 21224208000866.pdf successfully. Size:", fs.statSync("21224208000866.pdf").size, "bytes");
}

generateTestPdf();
