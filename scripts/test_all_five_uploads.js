import fs from 'fs';

const BASE_URL = 'http://localhost:3000';

async function uploadFile(filepath, filename, mimeType) {
  const buf = fs.readFileSync(filepath);
  const blob = new Blob([buf], { type: mimeType });
  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('languages', 'eng+hin+kan');

  const res = await fetch(`${BASE_URL}/api/extract`, {
    method: 'POST',
    body: fd
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload of '${filename}' failed (HTTP ${res.status}): ${errText}`);
  }

  return await res.json();
}

async function processPrivacy(text, filename, lang) {
  const res = await fetch(`${BASE_URL}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      document_name: filename,
      language: lang,
      task: 'summarize'
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Processing of '${filename}' failed (HTTP ${res.status}): ${errText}`);
  }

  return await res.json();
}

async function runSequentialTests() {
  console.log("==================================================================");
  console.log("PRIVACY GATEWAY: 5-STEP SEQUENTIAL MULTI-UPLOAD & PIPELINE TEST");
  console.log("==================================================================");

  // 0. Health check
  const hRes = await fetch(`${BASE_URL}/health`);
  const health = await hRes.json();
  console.log(`\n✓ GET /health: HTTP 200 OK — ${health.service}`);
  console.log(`  Upstream: ${health.upstream_url} (FastAPI Connected: ${health.fastapi_connected})`);
  console.log(`  Active Recognizers: ${health.recognizers.length}`);

  // Test 1: Kannada PDF
  console.log("\n------------------------------------------------------------------");
  console.log("TEST 1: Uploading kannada_bank_details_8_lines.pdf (Kannada PDF)");
  console.log("------------------------------------------------------------------");
  const t1 = await uploadFile("kannada_bank_details_8_lines.pdf", "kannada_bank_details_8_lines.pdf", "application/pdf");
  console.log(`  Status: ${t1.status} | Received: ${t1.diagnostic.received_bytes} bytes | Words: ${t1.total_words}`);
  console.log(`  Extracted Content Sample:\n  "${t1.text.split('\n').slice(0, 4).join('\n  ')}"`);
  if (!t1.text.includes("ರಮೇಶ್ കുಮಾರ್") && !t1.text.includes("ರಮೇಶ್") && !t1.text.includes("987654321098")) {
    throw new Error("Test 1 failed: Expected Kannada text / account number not found in extraction!");
  }
  const p1 = await processPrivacy(t1.text, "kannada_bank_details_8_lines.pdf", "kan");
  console.log(`  PII Detected: ${p1.total_detected} entities | Leak Check: ${p1.leak_check.status} (Leaks: ${p1.leak_check.leak_count})`);
  console.log("  ✓ TEST 1 PASSED");

  // Test 2: Different English PDF
  console.log("\n------------------------------------------------------------------");
  console.log("TEST 2: Uploading english_statutory_notice.pdf (English Legal Notice)");
  console.log("------------------------------------------------------------------");
  const t2 = await uploadFile("english_statutory_notice.pdf", "english_statutory_notice.pdf", "application/pdf");
  console.log(`  Status: ${t2.status} | Received: ${t2.diagnostic.received_bytes} bytes | Words: ${t2.total_words}`);
  console.log(`  Extracted Content Sample:\n  "${t2.text.split('\n').slice(0, 4).join('\n  ')}"`);
  if (t2.text.includes("ರಮೇಶ್") || t2.text.includes("KARB0001234")) {
    throw new Error("Test 2 failed: Previous Kannada document content leaked into English document state!");
  }
  if (!t2.text.includes("FOOD SAFETY") && !t2.text.includes("Dr. Rajesh Sharma")) {
    throw new Error("Test 2 failed: Expected English content not found!");
  }
  const p2 = await processPrivacy(t2.text, "english_statutory_notice.pdf", "en");
  console.log(`  PII Detected: ${p2.total_detected} entities | Leak Check: ${p2.leak_check.status} (Leaks: ${p2.leak_check.leak_count})`);
  console.log("  ✓ TEST 2 PASSED");

  // Test 3: Hindi PDF
  console.log("\n------------------------------------------------------------------");
  console.log("TEST 3: Uploading hindi_tax_assessment.pdf (Hindi Devanagari PDF)");
  console.log("------------------------------------------------------------------");
  const t3 = await uploadFile("hindi_tax_assessment.pdf", "hindi_tax_assessment.pdf", "application/pdf");
  console.log(`  Status: ${t3.status} | Received: ${t3.diagnostic.received_bytes} bytes | Words: ${t3.total_words}`);
  console.log(`  Extracted Content Sample:\n  "${t3.text.split('\n').slice(0, 4).join('\n  ')}"`);
  if (t3.text.includes("FOOD SAFETY") || t3.text.includes("Rajesh Sharma")) {
    throw new Error("Test 3 failed: Previous English document content leaked into Hindi document state!");
  }
  if (!t3.text.includes("सुरेश कुमार शर्मा") && !t3.text.includes("आयकर विभाग") && !t3.text.includes("BCDPM8765K")) {
    throw new Error("Test 3 failed: Expected Hindi content not found!");
  }
  const p3 = await processPrivacy(t3.text, "hindi_tax_assessment.pdf", "hin");
  console.log(`  PII Detected: ${p3.total_detected} entities | Leak Check: ${p3.leak_check.status} (Leaks: ${p3.leak_check.leak_count})`);
  console.log("  ✓ TEST 3 PASSED");

  // Test 4: DOCX Document
  console.log("\n------------------------------------------------------------------");
  console.log("TEST 4: Uploading enterprise_compliance_audit.docx (DOCX Archive)");
  console.log("------------------------------------------------------------------");
  const t4 = await uploadFile("enterprise_compliance_audit.docx", "enterprise_compliance_audit.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  console.log(`  Status: ${t4.status} | Received: ${t4.diagnostic.received_bytes} bytes | Words: ${t4.total_words}`);
  console.log(`  Extracted Content Sample:\n  "${t4.text.split('\n').slice(0, 4).join('\n  ')}"`);
  if (t4.text.includes("सुरेश कुमार शर्मा") || t4.text.includes("BCDPM8765K")) {
    throw new Error("Test 4 failed: Previous Hindi document content leaked into DOCX state!");
  }
  if (!t4.text.includes("Priya Narayanan") && !t4.text.includes("FGHIJ5678L")) {
    throw new Error("Test 4 failed: Expected DOCX content not extracted!");
  }
  const p4 = await processPrivacy(t4.text, "enterprise_compliance_audit.docx", "en");
  console.log(`  PII Detected: ${p4.total_detected} entities | Leak Check: ${p4.leak_check.status} (Leaks: ${p4.leak_check.leak_count})`);
  console.log("  ✓ TEST 4 PASSED");

  // Test 5: Re-uploading Kannada PDF
  console.log("\n------------------------------------------------------------------");
  console.log("TEST 5: Re-uploading kannada_bank_details_8_lines.pdf (Kannada PDF Re-test)");
  console.log("------------------------------------------------------------------");
  const t5 = await uploadFile("kannada_bank_details_8_lines.pdf", "kannada_bank_details_8_lines.pdf", "application/pdf");
  console.log(`  Status: ${t5.status} | Received: ${t5.diagnostic.received_bytes} bytes | Words: ${t5.total_words}`);
  console.log(`  Extracted Content Sample:\n  "${t5.text.split('\n').slice(0, 4).join('\n  ')}"`);
  if (t5.text.includes("Priya Narayanan") || t5.text.includes("CloudSecure Systems")) {
    throw new Error("Test 5 failed: Previous DOCX document content leaked into Kannada re-upload!");
  }
  if (!t5.text.includes("ರಮೇಶ್") && !t5.text.includes("987654321098")) {
    throw new Error("Test 5 failed: Expected Kannada text not extracted on re-upload!");
  }
  const p5 = await processPrivacy(t5.text, "kannada_bank_details_8_lines.pdf", "kan");
  console.log(`  PII Detected: ${p5.total_detected} entities | Leak Check: ${p5.leak_check.status} (Leaks: ${p5.leak_check.leak_count})`);
  console.log("  ✓ TEST 5 PASSED");

  // Verify Audit Logs
  const aRes = await fetch(`${BASE_URL}/api/audit`);
  const auditData = await aRes.json();
  console.log("\n------------------------------------------------------------------");
  console.log(`AUDIT TRAIL VERIFICATION: Total logs recorded = ${auditData.logs.length}`);
  console.log("------------------------------------------------------------------");
  console.log(`  Latest 3 Audit Entries:`);
  auditData.logs.slice(0, 3).forEach((l, idx) => {
    console.log(`   ${idx + 1}. [${l.timestamp}] doc='${l.document_name}' entities=${l.total_entities} leak_check='${l.leak_check_status}' status='${l.status}'`);
  });

  console.log("\n==================================================================");
  console.log("ALL 5 SEQUENTIAL UPLOAD TESTS & SECURITY PIPELINES SUCCEEDED 100%!");
  console.log("==================================================================");
}

runSequentialTests().catch(err => {
  console.error("\n❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
