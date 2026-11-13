import fs from 'fs';

function generateKannadaPdf() {
  const content = 
`ಕರ್ನಾಟಕ ಬ್ಯಾಂಕ್ ನಿಯಮಿತ / KARNATAKA BANK LTD
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

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  function addObj(c) {
    offsets.push(pdf.length);
    pdf += c + "\n";
  }

  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  addObj("11 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");

  const lines = content.split("\n");
  let streamBody = "BT\n/F1 11 Tf\n50 720 Td\n18 TL\n";
  for (const line of lines) {
    const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    streamBody += `(${escaped}) '\n`;
  }
  streamBody += "ET\n";

  addObj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 11 0 R >> >> >>\nendobj`);
  addObj(`4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}endstream\nendobj`);

  const xrefOffset = pdf.length;
  pdf += "xref\n0 5\n0000000000 65535 f \n";
  for (let i = 0; i < 4; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";

  fs.writeFileSync("dummy_kannada_bank_details.pdf", Buffer.from(pdf, "utf8"));
  console.log("Created dummy_kannada_bank_details.pdf, size:", fs.statSync("dummy_kannada_bank_details.pdf").size, "bytes");
}

generateKannadaPdf();
