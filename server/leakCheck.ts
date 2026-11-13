/**
 * Mandatory Pre-Flight Leak Check Module
 *
 * Scans the COMPLETE sanitized outbound payload before any external LLM API request.
 * Compares the payload against every original sensitive value in the local mapping
 * AND performs secondary format cross-validation.
 *
 * Blocks the external API request immediately if ANY raw PII value is detected.
 */

export interface LeakViolation {
  token: string;
  reason: string;
  sample: string;
}

export interface LeakCheckResult {
  passed: boolean;
  leak_count: number;
  status: 'Leak Check Passed' | 'Leak Detected – Request Blocked';
  checks_performed: string[];
  violations: LeakViolation[];
}

function redactSample(raw: string): string {
  const clean = raw.trim();
  if (clean.length <= 3) return '***';
  return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
}

export function performLeakCheck(
  outboundPayload: string,
  tokenMapping: Record<string, string>
): LeakCheckResult {
  const violations: LeakViolation[] = [];
  const lowerPayload = outboundPayload.toLowerCase();
  const condensedPayload = outboundPayload.replace(/[\s-]+/g, '');

  for (const [token, rawVal] of Object.entries(tokenMapping)) {
    const clean = rawVal.trim();
    if (clean.length < 3) continue;

    // 1. Exact raw value containment scan
    if (outboundPayload.includes(clean)) {
      violations.push({
        token,
        reason: 'Exact original PII value detected in outbound LLM payload',
        sample: redactSample(clean)
      });
      continue;
    }

    // 2. Case-insensitive containment for multi-char identifiers/names/emails/addresses
    if (clean.length >= 5 && !token.startsWith('<SAFEHOLDER_PINCODE_') && !token.startsWith('<PINCODE_')) {
      const isAsciiSingleWord = /^[A-Za-z]+$/.test(clean);
      const hasMatch = isAsciiSingleWord
        ? new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(outboundPayload)
        : lowerPayload.includes(clean.toLowerCase());
      if (hasMatch) {
        violations.push({
          token,
          reason: 'Case-insensitive original PII value detected in outbound LLM payload',
          sample: redactSample(clean)
        });
        continue;
      }
    }

    // 3. Digit-normalized containment for Aadhaar, Phone, Bank Account, Card numbers
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length >= 10 && condensedPayload.includes(digitsOnly)) {
      violations.push({
        token,
        reason: 'Normalized sensitive digit sequence detected in outbound LLM payload',
        sample: redactSample(digitsOnly)
      });
    }
  }

  // 4. Independent regex sweep on outbound payload for unmasked Indian high-risk identifiers
  const panMatches = outboundPayload.match(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g);
  if (panMatches) {
    violations.push({
      token: 'UNMASKED_PAN',
      reason: `Unmasked PAN identifier pattern detected (${panMatches.length} match)`,
      sample: redactSample(panMatches[0])
    });
  }

  const gstinMatches = outboundPayload.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g);
  if (gstinMatches) {
    violations.push({
      token: 'UNMASKED_GSTIN',
      reason: `Unmasked GSTIN identifier pattern detected (${gstinMatches.length} match)`,
      sample: redactSample(gstinMatches[0])
    });
  }

  const aadhaarMatches = outboundPayload.match(/\b[2-9][0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4}\b/g);
  if (aadhaarMatches) {
    violations.push({
      token: 'UNMASKED_AADHAAR',
      reason: `Unmasked Aadhaar pattern detected (${aadhaarMatches.length} match)`,
      sample: redactSample(aadhaarMatches[0])
    });
  }

  const emailMatches = outboundPayload.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10}\b/g);
  if (emailMatches) {
    violations.push({
      token: 'UNMASKED_EMAIL',
      reason: `Unmasked Email address detected (${emailMatches.length} match)`,
      sample: redactSample(emailMatches[0])
    });
  }

  const ssnMatches = outboundPayload.match(/\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g);
  if (ssnMatches) {
    violations.push({
      token: 'UNMASKED_US_SSN',
      reason: `Unmasked US SSN pattern detected (${ssnMatches.length} match)`,
      sample: redactSample(ssnMatches[0])
    });
  }

  const passed = violations.length === 0;
  return {
    passed,
    leak_count: violations.length,
    status: passed ? 'Leak Check Passed' : 'Leak Detected – Request Blocked',
    checks_performed: [
      'Exact Raw PII Match Scan',
      'Case-Insensitive Entity Containment Scan',
      'Digit-Normalized Aadhaar/Phone/Account Scan',
      'Independent PAN / GSTIN / Email / SSN Regex Sweep'
    ],
    violations
  };
}
