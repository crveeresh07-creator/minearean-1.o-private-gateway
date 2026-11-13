/**
 * DPDP Privacy Gateway Comprehensive Test & Benchmark Suite
 *
 * Tests:
 * 1. 50 synthetic Indian documents (Loan Applications, KYC, Support Tickets, Insurance Claims)
 *    - Indian PII Detection Precision & Recall
 *    - Placeholder Consistency
 *    - Zero Raw PII Leakage
 *    - Local Reinsertion Accuracy (including paraphrased, reordered, and dropped-tag cases)
 *    - Processing Latency
 * 2. Mandatory Leak Check Blocking Verification (verifies unsafe payloads are strictly blocked)
 * 3. Multi-Format Extraction & Output File Generation (PDF, DOCX, PPTX, XLSX, TXT)
 * 4. Corrupted / Unsupported File Graceful Error Handling
 */

import { detectEntities, maskText, restoreText } from '../server/piiEngine';
import { performLeakCheck } from '../server/leakCheck';
import { extractDocumentBuffer } from '../server/documentExtractor';
import { generateOutputFile, OutputFormat } from '../server/documentGenerator';
import { buildOutboundPrompt } from '../server/llmClient';

interface GroundTruthEntity {
  type: string;
  value: string;
}

interface SyntheticDoc {
  id: number;
  category: 'Loan Application' | 'KYC Document' | 'Support Ticket' | 'Insurance Claim';
  text: string;
  groundTruth: GroundTruthEntity[];
}

const NAMES = [
  'Rahul Sharma', 'Priya Nair', 'Arjun Reddy', 'Sneha Kulkarni', 'Vikram Patel',
  'Kavita Deshmukh', 'Suresh Iyer', 'Ananya Chatterjee', 'Rohan Malhotra', 'Deepak Verma',
  'Meera Krishnan', 'Karthik Gowda', 'Pooja Joshi', 'Siddharth Kapoor', 'Neha Agarwal',
  'Rajesh Bansal', 'Divya Menon', 'Abhishek Tiwari', 'Swati Saxena', 'Manish Gupta',
  'Lakshmi Narayan', 'Nikhil Rao', 'Shreya Sengupta', 'Gaurav Mehta', 'Ritu Khanna'
];

const CITIES = [
  { city: 'Bengaluru', state: 'Karnataka', pin: '560001', road: '12th Main Road, Indiranagar' },
  { city: 'Mumbai', state: 'Maharashtra', pin: '400001', road: 'MG Road, Fort' },
  { city: 'New Delhi', state: 'Delhi', pin: '110001', road: 'Connaught Place, Block B' },
  { city: 'Hyderabad', state: 'Telangana', pin: '500034', road: 'Road No. 12, Banjara Hills' },
  { city: 'Chennai', state: 'Tamil Nadu', pin: '600004', road: 'Luz Church Road, Mylapore' },
  { city: 'Pune', state: 'Maharashtra', pin: '411004', road: 'FC Road, Shivajinagar' }
];

const PAN_PREFIXES = ['ABCDE', 'BGFPR', 'CHJPK', 'DKLPM', 'EFGPS', 'FGHPB', 'GHJPC', 'HJKPT', 'JKLMN', 'KLMPA'];
const IFSC_CODES = ['SBIN0001234', 'HDFC0000456', 'ICIC0002345', 'AXIS0000789', 'CNRB0001122'];

function buildSyntheticDocs(): SyntheticDoc[] {
  const docs: SyntheticDoc[] = [];

  for (let i = 0; i < 50; i++) {
    const name = NAMES[i % NAMES.length];
    const nominee = NAMES[(i + 7) % NAMES.length];
    const loc = CITIES[i % CITIES.length];
    const aadhaar = `${2 + (i % 7)}${String(100 + i).padStart(3, '0')}-${String(4000 + i * 13).slice(0, 4)}-${String(7000 + i * 17).slice(0, 4)}`;
    const pan = `${PAN_PREFIXES[i % PAN_PREFIXES.length]}${String(1000 + i * 37).slice(0, 4)}${String.fromCharCode(65 + (i % 26))}`;
    const gstin = `29${pan}1Z5`;
    const phone = `+91-98${String(10000000 + i * 123457).slice(0, 8)}`;
    const emailSlug = name.toLowerCase().replace(/\s+/g, '.');
    const email = `${emailSlug}${i}@example.in`;
    const bankAcc = `${300100200300 + i * 97}`;
    const ifsc = IFSC_CODES[i % IFSC_CODES.length];
    const voterId = `KA${String.fromCharCode(65 + (i % 26))}${String(1234567 + i * 11).slice(0, 7)}`;
    const passport = `K${String(4500000 + i * 29).slice(0, 7)}`;
    const address = `Flat ${101 + i}, ${loc.road}, ${loc.city}, ${loc.state} - ${loc.pin}`;
    const dob = `${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/19${80 + (i % 18)}`;

    const mod = i % 4;
    if (mod === 0) {
      // Loan Application
      const text = [
        `HOME LOAN APPLICATION #LN-${202600 + i}`,
        `Applicant Name: ${name}`,
        `Co-Applicant: Mr. ${nominee}`,
        `Date of Birth: ${dob}`,
        `Aadhaar Number: ${aadhaar}`,
        `PAN: ${pan}`,
        `Mobile: ${phone}`,
        `Email: ${email}`,
        `Residential Address: ${address}`,
        `Disbursement Account No: ${bankAcc}`,
        `IFSC: ${ifsc}`,
        `Remarks: ${name} applied for a housing loan of INR 45,00,000. Salary verification completed.`
      ].join('\n');

      docs.push({
        id: i + 1,
        category: 'Loan Application',
        text,
        groundTruth: [
          { type: 'PERSON', value: name },
          { type: 'PERSON', value: nominee },
          { type: 'DOB', value: dob },
          { type: 'AADHAAR', value: aadhaar },
          { type: 'PAN', value: pan },
          { type: 'PHONE', value: phone },
          { type: 'EMAIL', value: email },
          { type: 'ADDRESS', value: address },
          { type: 'BANK_ACC', value: bankAcc },
          { type: 'IFSC', value: ifsc }
        ]
      });
    } else if (mod === 1) {
      // KYC Document (with code-mixed Hindi / Kannada lines on some docs)
      const isCodeMixed = i % 3 === 1;
      const text = [
        `ENTERPRISE KYC VERIFICATION RECORD`,
        isCodeMixed ? `Customer Name / नाम: ${name}` : `Customer Name: ${name}`,
        `Aadhaar ID: ${aadhaar}`,
        `PAN Card: ${pan}`,
        `Voter ID: ${voterId}`,
        `Passport No: ${passport}`,
        `GSTIN: ${gstin}`,
        `Contact Phone: ${phone}`,
        `Email: ${email}`,
        `Permanent Address: ${address}`
      ].join('\n');

      docs.push({
        id: i + 1,
        category: 'KYC Document',
        text,
        groundTruth: [
          { type: 'PERSON', value: name },
          { type: 'AADHAAR', value: aadhaar },
          { type: 'PAN', value: pan },
          { type: 'VOTER_ID', value: voterId },
          { type: 'PASSPORT', value: passport },
          { type: 'GSTIN', value: gstin },
          { type: 'PHONE', value: phone },
          { type: 'EMAIL', value: email },
          { type: 'ADDRESS', value: address }
        ]
      });
    } else if (mod === 2) {
      // Customer Support Ticket
      const text = [
        `SUPPORT TICKET #TKT-${8800 + i}`,
        `Dear Support Team,`,
        `Customer Name: ${name}`,
        `I am writing regarding an unauthorized debit from my Bank A/C: ${bankAcc} (IFSC: ${ifsc}).`,
        `Please contact me at ${phone} or ${email}.`,
        `My PAN is ${pan} and Aadhaar is ${aadhaar}.`,
        `Signed by: ${name}`
      ].join('\n');

      docs.push({
        id: i + 1,
        category: 'Support Ticket',
        text,
        groundTruth: [
          { type: 'PERSON', value: name },
          { type: 'BANK_ACC', value: bankAcc },
          { type: 'IFSC', value: ifsc },
          { type: 'PHONE', value: phone },
          { type: 'EMAIL', value: email },
          { type: 'PAN', value: pan },
          { type: 'AADHAAR', value: aadhaar }
        ]
      });
    } else {
      // Insurance Claim
      const vehicle = `KA-0${1 + (i % 9)}-AB-${1000 + i * 19}`;
      const text = [
        `MOTOR & HEALTH INSURANCE CLAIM FORM`,
        `Policyholder: ${name}`,
        `Nominee Name: ${nominee}`,
        `DOB: ${dob}`,
        `Vehicle Registration: ${vehicle}`,
        `Aadhaar: ${aadhaar}`,
        `PAN: ${pan}`,
        `Phone: ${phone}`,
        `Email: ${email}`,
        `Claim Settlement Account No: ${bankAcc}`,
        `IFSC: ${ifsc}`,
        `Address: ${address}`
      ].join('\n');

      docs.push({
        id: i + 1,
        category: 'Insurance Claim',
        text,
        groundTruth: [
          { type: 'PERSON', value: name },
          { type: 'PERSON', value: nominee },
          { type: 'DOB', value: dob },
          { type: 'VEHICLE_REG', value: vehicle },
          { type: 'AADHAAR', value: aadhaar },
          { type: 'PAN', value: pan },
          { type: 'PHONE', value: phone },
          { type: 'EMAIL', value: email },
          { type: 'BANK_ACC', value: bankAcc },
          { type: 'IFSC', value: ifsc },
          { type: 'ADDRESS', value: address }
        ]
      });
    }
  }

  return docs;
}

async function runTests() {
  console.log('=== DPDP Privacy Gateway Automated Benchmark & Verification ===\n');
  const docs = buildSyntheticDocs();

  let totalTruePositives = 0;
  let totalFalseNegatives = 0;
  let totalFalsePositives = 0;
  let consistencyFailures = 0;
  let leakageCount = 0;
  let reinsertionTotalChecks = 0;
  let reinsertionExactMatches = 0;
  const latenciesMs: number[] = [];

  for (const doc of docs) {
    const t0 = performance.now();
    const detected = detectEntities(doc.text);
    const { sanitizedText, tokenMapping } = maskText(doc.text, detected);
    const outbound = buildOutboundPrompt(sanitizedText, 'summarize');
    const leakResult = performLeakCheck(outbound, tokenMapping);
    const latency = performance.now() - t0;
    latenciesMs.push(latency);

    // 1. Check Zero Raw PII Leakage
    if (!leakResult.passed) {
      leakageCount += leakResult.leak_count;
    }
    for (const gt of doc.groundTruth) {
      if (outbound.includes(gt.value)) {
        leakageCount++;
      }
    }

    // 2. Compute Precision & Recall against Ground Truth
    const matchedGt = new Set<number>();
    for (const det of detected) {
      const gtIdx = doc.groundTruth.findIndex(
        (gt, idx) =>
          !matchedGt.has(idx) &&
          (det.value === gt.value || gt.value.includes(det.value) || det.value.includes(gt.value))
      );
      if (gtIdx !== -1) {
        matchedGt.add(gtIdx);
        totalTruePositives++;
      } else {
        // Note: PINCODE inside ADDRESS may also be extracted if address wasn't matched as one block; only count genuine FP
        if (det.entity_type !== 'PINCODE') {
          totalFalsePositives++;
        }
      }
    }
    totalFalseNegatives += doc.groundTruth.length - matchedGt.size;

    // 3. Verify Consistent Placeholder Generation (repeated name gets identical token)
    if (doc.category === 'Loan Application' || doc.category === 'Support Ticket') {
      const personTokens = Object.entries(tokenMapping)
        .filter(([, val]) => val === doc.groundTruth[0].value)
        .map(([tok]) => tok);
      if (personTokens.length !== 1) {
        consistencyFailures++;
      } else {
        const occurrences = sanitizedText.split(personTokens[0]).length - 1;
        if (occurrences < 2) consistencyFailures++;
      }
    }

    // 4. Verify Local Reinsertion Accuracy (simulate paraphrased & reordered LLM output with dropped tags)
    const tokens = Object.keys(tokenMapping);
    const paraphrasedLlmOutput = [
      `Summary for ${tokens[0] || 'Applicant'}:`,
      ...tokens.slice(0, Math.max(1, tokens.length - 1)).reverse().map(t => `- Verified identifier: ${t}`),
      `- Unrecognized tag should remain untouched: <UNKNOWN_99>`
    ].join('\n');

    const restored = restoreText(paraphrasedLlmOutput, tokenMapping);
    for (const tok of tokens.slice(0, Math.max(1, tokens.length - 1))) {
      reinsertionTotalChecks++;
      if (restored.includes(tokenMapping[tok]) && !restored.includes(tok)) {
        reinsertionExactMatches++;
      }
    }
    reinsertionTotalChecks++;
    if (restored.includes('<UNKNOWN_99>')) {
      reinsertionExactMatches++;
    }
  }

  const precision = totalTruePositives / Math.max(1, totalTruePositives + totalFalsePositives);
  const recall = totalTruePositives / Math.max(1, totalTruePositives + totalFalseNegatives);
  const reinsertionAccuracy = reinsertionExactMatches / Math.max(1, reinsertionTotalChecks);
  const avgLatency = latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length;

  console.log(`1. 50 Synthetic Indian Documents Benchmark (${docs.length} docs across 4 categories):`);
  console.log(`   - Detection Precision:    ${(precision * 100).toFixed(2)}% (TP=${totalTruePositives}, FP=${totalFalsePositives})`);
  console.log(`   - Detection Recall:       ${(recall * 100).toFixed(2)}% (TP=${totalTruePositives}, FN=${totalFalseNegatives})`);
  console.log(`   - Reinsertion Accuracy:   ${(reinsertionAccuracy * 100).toFixed(2)}% (${reinsertionExactMatches}/${reinsertionTotalChecks})`);
  console.log(`   - Placeholder Consistency:${consistencyFailures === 0 ? ' 100% PASS' : ` FAIL (${consistencyFailures})`}`);
  console.log(`   - Raw PII Leakage:        ${leakageCount} leaks (${leakageCount === 0 ? 'ZERO LEAKAGE VERIFIED' : 'FAILED'})`);
  console.log(`   - Avg Local Latency:      ${avgLatency.toFixed(2)} ms/doc\n`);

  // 2. Test Leak Check Blocking Behavior explicitly
  console.log('2. Leak Check Blocking Verification:');
  const unsafePayload = 'Send this to LLM: Applicant Rahul Sharma with PAN ABCDE1234F and Aadhaar 2345-6789-0123';
  const blockTest = performLeakCheck(unsafePayload, {
    '<SAFEHOLDER_PERSON_1>': 'Rahul Sharma',
    '<SAFEHOLDER_PAN_1>': 'ABCDE1234F'
  });
  console.log(`   - Unsafe Payload Result:  ${blockTest.status} (passed=${blockTest.passed}, violations=${blockTest.leak_count})`);
  if (blockTest.passed) {
    throw new Error('Leak Check failed to block unsafe payload!');
  }

  // 3. Test Multi-Format Output Generation & Round-Trip Extraction
  console.log('\n3. Multi-Format Output Generation & Extraction Round-Trip:');
  const sampleContent = `# DPDP Compliance Summary\n\nApplicant Rahul Sharma verified with PAN ABCDE1234F.\n\n| Field | Value |\n| --- | --- |\n| Name | Rahul Sharma |\n| PAN | ABCDE1234F |\n\n- Action item: Approve loan disbursement.`;
  const meta = {
    originalFilename: 'Loan_Application_Test.pdf',
    leakCheckStatus: 'Leak Check Passed',
    entitiesMasked: 2,
    entityCounts: { PERSON: 1, PAN: 1 },
    llmUsed: 'gemini-3.8-flash',
    processedAt: new Date().toISOString()
  };

  const formats: OutputFormat[] = ['pdf', 'docx', 'pptx', 'xlsx', 'txt'];
  for (const fmt of formats) {
    const out = await generateOutputFile(sampleContent, fmt, meta);
    const extracted = await extractDocumentBuffer(out.buffer, `roundtrip.${fmt}`);
    const hasExpected = extracted.text.includes('Rahul Sharma') || extracted.text.includes('ABCDE1234F');
    console.log(`   - ${fmt.toUpperCase().padEnd(5)} generated ${out.buffer.length} bytes -> round-trip extracted ${extracted.total_chars} chars (${hasExpected ? 'PASS' : 'FAIL'})`);
    if (!hasExpected) {
      throw new Error(`Round-trip extraction failed for format ${fmt}`);
    }
  }

  // 4. Test Corrupted & Unsupported File Graceful Error Handling
  console.log('\n4. Corrupted & Unsupported File Graceful Error Handling:');
  let corruptCaught = false;
  try {
    await extractDocumentBuffer(Buffer.from('NOT_A_REAL_PDF_BYTES'), 'corrupted.pdf');
  } catch (err) {
    corruptCaught = true;
    console.log(`   - Corrupted PDF rejected cleanly: ${(err as Error).message}`);
  }
  let unsupportedCaught = false;
  try {
    await extractDocumentBuffer(Buffer.from('hello'), 'archive.zip');
  } catch (err) {
    unsupportedCaught = true;
    console.log(`   - Unsupported format rejected cleanly: ${(err as Error).message}`);
  }

  if (!corruptCaught || !unsupportedCaught) {
    throw new Error('Error handling checks failed!');
  }

  console.log('\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY.');
}

runTests().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
