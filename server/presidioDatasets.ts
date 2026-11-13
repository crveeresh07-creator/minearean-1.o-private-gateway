/**
 * Extended Microsoft Presidio Supported Entities Dataset
 * Covers Global, Regional (USA, UK, ES, IT, PL, SG, AU, IN, FI, KR, NG, PH, CA, SE, ZA, TH, TR, DE),
 * and Medical/Clinical NER recognizers with checksum validation and context guards.
 */

export interface DatasetPatternRule {
  entityType: string;
  regex: RegExp;
  groupIndex: number;
  score: number;
  method: string;
  validate?: (value: string, fullText: string, start: number, end: number) => boolean;
}

export function hasContext(text: string, start: number, end: number, keywords: RegExp, radius = 75): boolean {
  const ws = Math.max(0, start - radius);
  const we = Math.min(text.length, end + radius);
  return keywords.test(text.slice(ws, we));
}

// ---------------------------------------------------------------------------
// Checksum Validators
// ---------------------------------------------------------------------------

export function validateLuhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateIban(raw: string): boolean {
  const clean = raw.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < expanded.length; i++) {
    rem = (rem * 10 + parseInt(expanded[i], 10)) % 97;
  }
  return rem === 1;
}

export function validatePesel(raw: string): boolean {
  if (!/^\d{11}$/.test(raw)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(raw[i], 10) * weights[i];
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(raw[10], 10);
}

export function validateTurkishId(raw: string): boolean {
  if (!/^[1-9]\d{10}$/.test(raw)) return false;
  const d = raw.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const d10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  const d11 = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  return d[9] === d10 && d[10] === d11;
}

export function validateThaiId(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (!/^[1-8]\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(digits[12], 10);
}

export function validateAustralianAbn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const first = parseInt(digits[0], 10) - 1;
  if (first < 0) return false;
  let sum = first * weights[0];
  for (let i = 1; i < 11; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  return sum % 89 === 0;
}

export function validateSpanishNif(raw: string): boolean {
  const clean = raw.toUpperCase().replace(/[-\s]/g, '');
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^\d{8}[A-Z]$/.test(clean)) {
    const num = parseInt(clean.slice(0, 8), 10);
    return letters[num % 23] === clean[8];
  }
  return false;
}

export function validateSpanishNie(raw: string): boolean {
  const clean = raw.toUpperCase().replace(/[-\s]/g, '');
  if (!/^[XYZ]\d{7}[A-Z]$/.test(clean)) return false;
  const prefixMap: Record<string, string> = { X: '0', Y: '1', Z: '2' };
  const numStr = prefixMap[clean[0]] + clean.slice(1, 8);
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  return letters[parseInt(numStr, 10) % 23] === clean[8];
}

export function validateDeTaxId(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  // ISO 7064 Mod 11, 10
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (parseInt(digits[i], 10) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return check === parseInt(digits[10], 10);
}

// ---------------------------------------------------------------------------
// Extended Presidio Dataset Rules (Global + Regional + Medical/Clinical)
// ---------------------------------------------------------------------------

export const PRESIDIO_EXTENDED_RULES: DatasetPatternRule[] = [
  // ======================== GLOBAL ========================
  {
    entityType: 'CREDIT_CARD',
    regex: /\b((?:4[0-9]{3}|5[1-5][0-9]{2}|6(?:011|5[0-9]{2})|3[47][0-9]{2})[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{1,7})\b/g,
    groupIndex: 1,
    score: 0.96,
    method: 'presidio-credit-card-luhn',
    validate: (val) => {
      const len = val.replace(/\D/g, '').length;
      return len >= 13 && len <= 19 && validateLuhn(val);
    }
  },
  {
    entityType: 'CRYPTO',
    regex: /\b((?:1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,59})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-crypto-btc',
    validate: (_val, text, s, e) => hasContext(text, s, e, /\b(?:btc|bitcoin|wallet|crypto|address|blockchain|transfer)\b/i)
  },
  {
    entityType: 'IBAN_CODE',
    regex: /\b([A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/g,
    groupIndex: 1,
    score: 0.97,
    method: 'presidio-iban-mod97',
    validate: (val) => validateIban(val)
  },
  {
    entityType: 'IP_ADDRESS',
    regex: /\b((?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-ipv4'
  },
  {
    entityType: 'IP_ADDRESS',
    regex: /\b((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-ipv6'
  },
  {
    entityType: 'MAC_ADDRESS',
    regex: /\b((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})\b/g,
    groupIndex: 1,
    score: 0.97,
    method: 'presidio-mac'
  },
  {
    entityType: 'UUID',
    regex: /\b([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi,
    groupIndex: 1,
    score: 0.96,
    method: 'presidio-uuid',
    validate: (val) => val.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  },
  {
    entityType: 'URL',
    regex: /\b(https?:\/\/[^\s<>"{}|\\^`\[\]]{4,})/gi,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-url'
  },
  {
    entityType: 'MEDICAL_LICENSE',
    regex: /(?:Medical\s*License|DEA(?:\s*No\.?)?|MCI(?:\s*Reg)?|NMC(?:\s*Reg)?)[:\s#-]*([A-Z]{1,3}[-]?\d{5,9})\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-medical-license'
  },
  {
    entityType: 'NRP',
    regex: /(?:Nationality|Citizenship|Religion|Religious\s*Group|Political\s*Affiliation|Party)[:\s-]+([A-Za-z][A-Za-z\s-]{2,35})/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-nrp-context',
    validate: (val) => val.trim().split(/\s+/).length <= 4
  },

  // ======================== USA ========================
  {
    entityType: 'US_SSN',
    regex: /\b((?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4})\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-us-ssn'
  },
  {
    entityType: 'US_ITIN',
    regex: /\b(9\d{2}[-\s]?[78]\d[-\s]?\d{4})\b/g,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-us-itin',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:itin|taxpayer|irs|tax)\b/i)
  },
  {
    entityType: 'US_PASSPORT',
    regex: /(?:US\s*Passport|Passport\s*(?:No\.?|Number|#))[:\s-]*([0-9]{9})\b/gi,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-us-passport'
  },
  {
    entityType: 'US_DRIVER_LICENSE',
    regex: /(?:Driver(?:'s)?\s*Licen[cs]e|DL\s*(?:No\.?|Number|#))[:\s-]*([A-Z0-9]{6,14})\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-us-dl'
  },
  {
    entityType: 'US_BANK_NUMBER',
    regex: /(?:US\s*Bank\s*(?:Account|No\.?)|Routing|Checking\s*Account)[:\s#-]*(\d{8,17})\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-us-bank'
  },
  {
    entityType: 'US_NPI',
    regex: /(?:NPI(?:\s*(?:No\.?|Number|#))?)[:\s-]*([12]\d{9})\b/gi,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-us-npi'
  },
  {
    entityType: 'US_MBI',
    regex: /\b([1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[-]?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[-]?[AC-HJKMNP-RT-Y]{2}\d{2})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-us-mbi'
  },
  {
    entityType: 'US_PROVIDER_TAX_ID',
    regex: /(?:TIN|EIN|Provider\s*Tax\s*ID)[:\s#-]*(\d{2}-\d{7})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-us-ein'
  },
  {
    entityType: 'US_CLAIM_NUMBER',
    regex: /(?:Claim\s*(?:No\.?|Number|ID|#))[:\s-]*([A-Z0-9-]{6,18})\b/gi,
    groupIndex: 1,
    score: 0.88,
    method: 'presidio-us-claim',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:medicare|medicaid|hipaa|cms|patient|hospital|medical|billing)\b/i)
  },
  {
    entityType: 'US_HEALTH_INSURANCE_MEMBER_ID',
    regex: /(?:Member\s*ID|Subscriber\s*ID)[:\s#-]*([A-Z0-9]{7,15})\b/gi,
    groupIndex: 1,
    score: 0.89,
    method: 'presidio-us-member-id'
  },
  {
    entityType: 'US_PRESCRIPTION_NUMBER',
    regex: /(?:Rx|Prescription)\s*(?:No\.?|Number|#)[:\s-]*([A-Z0-9-]{6,14})\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-us-rx'
  },
  {
    entityType: 'US_PRIOR_AUTHORIZATION_NUMBER',
    regex: /(?:Prior\s*Auth(?:orization)?\s*(?:No\.?|Number|ID|#))[:\s-]*([A-Z0-9-]{6,16})\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-us-prior-auth'
  },
  {
    entityType: 'US_REFERRAL_NUMBER',
    regex: /(?:Referral\s*(?:No\.?|Number|ID|#))[:\s-]*([A-Z0-9-]{6,16})\b/gi,
    groupIndex: 1,
    score: 0.88,
    method: 'presidio-us-referral'
  },

  // ======================== UK ========================
  {
    entityType: 'UK_NINO',
    regex: /\b([A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-uk-nino'
  },
  {
    entityType: 'UK_NHS',
    regex: /(?:NHS\s*(?:No\.?|Number|#))[:\s-]*(\d{3}[-\s]?\d{3}[-\s]?\d{4})\b/gi,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-uk-nhs'
  },
  {
    entityType: 'UK_POSTCODE',
    regex: /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/g,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-uk-postcode',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:uk|united kingdom|london|manchester|birmingham|postcode|postal|england|scotland|wales)\b/i)
  },
  {
    entityType: 'UK_PASSPORT',
    regex: /(?:UK\s*Passport|British\s*Passport)[:\s#-]*([A-Z]{2}\d{7}|\d{9})\b/gi,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-uk-passport'
  },
  {
    entityType: 'UK_DRIVING_LICENCE',
    regex: /\b([A-Z9]{5}\d{6}[A-Z9]{2}\d[A-Z]{2})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-uk-dvla'
  },
  {
    entityType: 'UK_VEHICLE_REGISTRATION',
    regex: /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/g,
    groupIndex: 1,
    score: 0.88,
    method: 'presidio-uk-plate',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:dvla|uk|vehicle|reg|plate|car|mot)\b/i)
  },

  // ======================== SPAIN ========================
  {
    entityType: 'ES_NIF',
    regex: /\b(\d{8}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE])\b/gi,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-es-nif-mod23',
    validate: (val) => validateSpanishNif(val)
  },
  {
    entityType: 'ES_NIE',
    regex: /\b([XYZ][-\s]?\d{7}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE])\b/gi,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-es-nie-mod23',
    validate: (val) => validateSpanishNie(val)
  },
  {
    entityType: 'ES_PASSPORT',
    regex: /(?:Spanish\s*Passport|Pasaporte)[:\s#-]*([A-Z]{3}\d{6})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-es-passport'
  },

  // ======================== ITALY ========================
  {
    entityType: 'IT_FISCAL_CODE',
    regex: /\b([A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z])\b/g,
    groupIndex: 1,
    score: 0.96,
    method: 'presidio-it-fiscal-code'
  },
  {
    entityType: 'IT_VAT_CODE',
    regex: /(?:Partita\s*IVA|P\.?\s*IVA|IT\s*VAT)[:\s#-]*((?:IT)?\d{11})\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-it-vat'
  },
  {
    entityType: 'IT_IDENTITY_CARD',
    regex: /(?:Carta\s*d'Identit[àa]|CIE)[:\s#-]*([A-Z]{2}\d{5}[A-Z]{2})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-it-cie'
  },
  {
    entityType: 'IT_DRIVER_LICENSE',
    regex: /(?:Patente)[:\s#-]*([A-Z]{2}\d{7}[A-Z])\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-it-dl'
  },
  {
    entityType: 'IT_PASSPORT',
    regex: /(?:Passaporto|Italian\s*Passport)[:\s#-]*([A-Z]{2}\d{7})\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-it-passport'
  },

  // ======================== POLAND ========================
  {
    entityType: 'PL_PESEL',
    regex: /\b(\d{11})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-pl-pesel',
    validate: (val, t, s, e) => validatePesel(val) && hasContext(t, s, e, /\b(?:pesel|poland|polish|pl)\b/i)
  },

  // ======================== SINGAPORE ========================
  {
    entityType: 'SG_NRIC_FIN',
    regex: /\b([STFGM]\d{7}[A-Z])\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-sg-nric',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:nric|fin|singapore|sg|pass)\b/i)
  },
  {
    entityType: 'SG_UEN',
    regex: /\b((?:\d{8,9}[A-Z])|(?:[TSR]\d{2}[A-Z]{2}\d{4}[A-Z]))\b/g,
    groupIndex: 1,
    score: 0.91,
    method: 'presidio-sg-uen',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:uen|acra|singapore|sg|entity)\b/i)
  },

  // ======================== AUSTRALIA ========================
  {
    entityType: 'AU_ABN',
    regex: /\b(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-au-abn-mod89',
    validate: (val, t, s, e) => validateAustralianAbn(val) && hasContext(t, s, e, /\b(?:abn|australian\s*business|australia|ato)\b/i)
  },
  {
    entityType: 'AU_ACN',
    regex: /(?:ACN)[:\s#-]*(\d{3}\s?\d{3}\s?\d{3})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-au-acn'
  },
  {
    entityType: 'AU_TFN',
    regex: /(?:TFN|Tax\s*File\s*Number)[:\s#-]*(\d{3}\s?\d{3}\s?\d{2,3})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-au-tfn'
  },
  {
    entityType: 'AU_MEDICARE',
    regex: /(?:Medicare(?:\s*(?:No\.?|Number|#))?)[:\s-]*([2-6]\d{3}\s?\d{5}\s?\d(?:[- ]?\d)?)\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-au-medicare'
  },

  // ======================== FINLAND ========================
  {
    entityType: 'FI_PERSONAL_IDENTITY_CODE',
    regex: /\b(\d{6}[+\-A-FU-Y]\d{3}[0-9A-FHJ-NPR-Y])\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-fi-hetu'
  },

  // ======================== KOREA ========================
  {
    entityType: 'KR_RRN',
    regex: /\b(\d{6}-[1-4]\d{6})\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-kr-rrn'
  },
  {
    entityType: 'KR_FRN',
    regex: /\b(\d{6}-[5-8]\d{6})\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-kr-frn'
  },
  {
    entityType: 'KR_DRIVER_LICENSE',
    regex: /\b(\d{2}-\d{2}-\d{6}-\d{2})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-kr-dl'
  },
  {
    entityType: 'KR_BRN',
    regex: /(?:BRN|Business\s*Reg(?:istration)?|사업자등록번호)[:\s#-]*(\d{3}-\d{2}-\d{5})\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-kr-brn'
  },
  {
    entityType: 'KR_PASSPORT',
    regex: /(?:Korean\s*Passport|Passport\s*(?:No\.?|#))[:\s-]*([MSRGD]\d{8})\b/gi,
    groupIndex: 1,
    score: 0.91,
    method: 'presidio-kr-passport'
  },

  // ======================== NIGERIA ========================
  {
    entityType: 'NG_NIN',
    regex: /(?:NIN|NIMC)[:\s#-]*(\d{11})\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-ng-nin'
  },
  {
    entityType: 'NG_VEHICLE_REGISTRATION',
    regex: /\b([A-Z]{3}[-\s]?\d{3}[A-Z]{2})\b/g,
    groupIndex: 1,
    score: 0.89,
    method: 'presidio-ng-plate',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:nigeria|frsc|lga|plate|vehicle)\b/i)
  },

  // ======================== PHILIPPINES ========================
  {
    entityType: 'PH_UMID',
    regex: /\b(\d{4}-\d{7}-\d)\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-ph-umid',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:umid|crn|sss|gsis|philhealth|pag-ibig|philippines)\b/i)
  },
  {
    entityType: 'PH_TIN',
    regex: /(?:BIR\s*TIN|TIN)[:\s#-]*(\d{3}-\d{3}-\d{3}(?:-\d{3,5})?)\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-ph-tin',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:philippines|bir|tin|tax)\b/i)
  },
  {
    entityType: 'PH_PASSPORT',
    regex: /(?:Philippine\s*Passport|Passport\s*(?:No\.?|#))[:\s-]*([A-Z]\d{7}[A-Z]|[A-Z]{2}\d{7})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-ph-passport'
  },

  // ======================== CANADA ========================
  {
    entityType: 'CA_SIN',
    regex: /\b([1-79]\d{2}[-\s]?\d{3}[-\s]?\d{3})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-ca-sin-luhn',
    validate: (val, t, s, e) => validateLuhn(val) && hasContext(t, s, e, /\b(?:sin|social\s*insurance|canada|esdc|cra)\b/i)
  },
  {
    entityType: 'CA_POSTAL_CODE',
    regex: /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d)\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-ca-postal'
  },

  // ======================== SWEDEN ========================
  {
    entityType: 'SE_PERSONNUMMER',
    regex: /\b((?:19|20)?\d{6}[-+]\d{4})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-se-personnummer',
    validate: (val, t, s, e) => {
      const digits10 = val.replace(/\D/g, '').slice(-10);
      return validateLuhn(digits10) && hasContext(t, s, e, /\b(?:personnummer|samordningsnummer|sweden|swedish|skatteverket)\b/i);
    }
  },
  {
    entityType: 'SE_ORGANISATIONSNUMMER',
    regex: /(?:Organisationsnummer|Org\.?\s*nr\.?)[:\s-]*(\d{6}-\d{4})\b/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-se-orgnr'
  },

  // ======================== SOUTH AFRICA ========================
  {
    entityType: 'ZA_ID_NUMBER',
    regex: /\b(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}[01]\d{2})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-za-id-luhn',
    validate: (val, t, s, e) => validateLuhn(val) && hasContext(t, s, e, /\b(?:south\s*africa|za|id\s*number|rsa|sars)\b/i)
  },
  {
    entityType: 'ZA_COMPANY_REGISTRATION',
    regex: /\b((?:19|20)\d{2}\/\d{6}\/\d{2}|CK\d{4}\/\d{6}\/\d{2})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-za-cipc'
  },
  {
    entityType: 'ZA_PASSPORT',
    regex: /(?:ZA\s*Passport|South\s*African\s*Passport)[:\s#-]*([ADMT]\d{8})\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'presidio-za-passport'
  },

  // ======================== THAILAND ========================
  {
    entityType: 'TH_TNIN',
    regex: /\b([1-8]-?\d{4}-?\d{5}-?\d{2}-?\d)\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-th-tnin',
    validate: (val) => validateThaiId(val)
  },

  // ======================== TURKEY ========================
  {
    entityType: 'TR_NATIONAL_ID',
    regex: /\b([1-9]\d{10})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-tr-tckn',
    validate: (val, t, s, e) => validateTurkishId(val) && hasContext(t, s, e, /\b(?:tckn|tc\s*kimlik|turkey|turkish|n[uü]fus)\b/i)
  },
  {
    entityType: 'TR_LICENSE_PLATE',
    regex: /\b((?:0[1-9]|[1-7]\d|8[01])\s?[A-Z]{1,3}\s?\d{2,4})\b/g,
    groupIndex: 1,
    score: 0.89,
    method: 'presidio-tr-plate',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:plaka|turkey|turkish|vehicle|ara[çc])\b/i)
  },

  // ======================== GERMANY ========================
  {
    entityType: 'DE_TAX_ID',
    regex: /\b([1-9]\d{10})\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'presidio-de-steuer-idnr',
    validate: (val, t, s, e) => validateDeTaxId(val) && hasContext(t, s, e, /\b(?:steuer|idnr|finanzamt|tax\s*id|germany|de)\b/i)
  },
  {
    entityType: 'DE_SOCIAL_SECURITY',
    regex: /\b(\d{2}(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[A-Z]\d{3})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-de-rvnr'
  },
  {
    entityType: 'DE_HEALTH_INSURANCE',
    regex: /(?:KVNR|Krankenversicherungsnummer|Versichertennummer)[:\s#-]*([A-Z]\d{9})\b/gi,
    groupIndex: 1,
    score: 0.94,
    method: 'presidio-de-kvnr'
  },
  {
    entityType: 'DE_HANDELSREGISTER',
    regex: /\b(HR[AB][ \t]?\d{1,6})\b/g,
    groupIndex: 1,
    score: 0.93,
    method: 'presidio-de-hr'
  },
  {
    entityType: 'DE_KFZ',
    regex: /(?:Kennzeichen|KFZ)[:\s#-]*([A-ZÄÖÜ]{1,3}[-\s][A-Z]{1,2}[-\s]\d{1,4}[EH]?)\b/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'presidio-de-kfz'
  },
  {
    entityType: 'DE_PLZ',
    regex: /\b((?:0[1-9]|[1-9]\d)\d{3})\b/g,
    groupIndex: 1,
    score: 0.85,
    method: 'presidio-de-plz',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:plz|postleitzahl|straße|strasse|berlin|munich|münchen|hamburg|frankfurt|köln|germany|deutschland)\b/i)
  },

  // ======================== MEDICAL / CLINICAL NER ========================
  {
    entityType: 'MEDICAL_BIOLOGICAL_ATTRIBUTE',
    regex: /\b((?:blood\s*pressure|bp|bmi|body\s*mass\s*index|hba1c|hemoglobin|hb|cholesterol|blood\s*sugar|glucose|heart\s*rate|pulse|spo2)[:\s-]*\d+(?:\.\d+)?(?:\/\d+)?(?:\s*(?:mmhg|mg\/dl|g\/dl|%|bpm|kg\/m2))?)\b/gi,
    groupIndex: 1,
    score: 0.91,
    method: 'medical-ner-attribute'
  },
  {
    entityType: 'MEDICAL_FAMILY_HISTORY',
    regex: /\b(family\s*(?:medical\s*)?history\s+of\s+[A-Za-z0-9,\s-]{3,50})/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'medical-ner-family-history'
  },
  {
    entityType: 'MEDICAL_HISTORY',
    regex: /\b((?:past\s*medical|patient|clinical)\s*history\s+of\s+[A-Za-z0-9,\s-]{3,50})/gi,
    groupIndex: 1,
    score: 0.9,
    method: 'medical-ner-history'
  },
  {
    entityType: 'MEDICAL_DISEASE_DISORDER',
    regex: /\b(type\s*[12]\s*diabetes(?:\s*mellitus)?|diabetes(?:\s*mellitus)?|hypertension|coronary\s*artery\s*disease|myocardial\s*infarction|chronic\s*kidney\s*disease|asthma|tuberculosis|pneumonia|rheumatoid\s*arthritis|osteoarthritis|hypothyroidism|hyperthyroidism|anemia|dengue|malaria|typhoid|hepatitis\s*[abc]|cirrhosis|epilepsy|migraine|depression|anxiety\s*disorder|carcinoma|leukemia|stroke)\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'medical-ner-disease'
  },
  {
    entityType: 'MEDICAL_MEDICATION',
    regex: /\b(metformin|aspirin|atorvastatin|amlodipine|insulin|paracetamol|acetaminophen|ibuprofen|amoxicillin|azithromycin|omeprazole|pantoprazole|losartan|telmisartan|clopidogrel|levothyroxine|prednisolone|warfarin|rosuvastatin|glimepiride|salbutamol|montelukast)\b/gi,
    groupIndex: 1,
    score: 0.92,
    method: 'medical-ner-medication'
  },
  {
    entityType: 'MEDICAL_THERAPEUTIC_PROCEDURE',
    regex: /\b(mri(?:\s*scan)?|ct\s*scan|echocardiogram|electrocardiogram|ecg|angioplasty|coronary\s*bypass|hemodialysis|dialysis|chemotherapy|radiotherapy|biopsy|endoscopy|colonoscopy|laparoscopy|appendectomy|cataract\s*surgery|physiotherapy|blood\s*transfusion)\b/gi,
    groupIndex: 1,
    score: 0.91,
    method: 'medical-ner-procedure'
  },
  {
    entityType: 'MEDICAL_CLINICAL_EVENT',
    regex: /\b(hospital\s*admission|icu\s*admission|emergency\s*admission|inpatient\s*discharge|surgical\s*discharge|triage\s*assessment|icu\s*transfer)\b/gi,
    groupIndex: 1,
    score: 0.89,
    method: 'medical-ner-event'
  },
  {
    entityType: 'MEDICAL_BIOLOGICAL_STRUCTURE',
    regex: /\b(left\s*ventricle|right\s*ventricle|coronary\s*artery|lumbar\s*spine|cervical\s*spine|hepatic\s*lobe|renal\s*cortex|cerebral\s*cortex|pulmonary\s*artery)\b/gi,
    groupIndex: 1,
    score: 0.89,
    method: 'medical-ner-anatomy',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:patient|diagnosis|scan|mri|ct|hospital|clinical|doctor|medical|surgery|report)\b/i)
  },

  // ======================== GENERAL LOCATION & DATE_TIME ========================
  {
    entityType: 'DATE_TIME',
    regex: /\b(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/g,
    groupIndex: 1,
    score: 0.88,
    method: 'presidio-iso-datetime',
    validate: (_v, t, s, e) => hasContext(t, s, e, /\b(?:dob|birth|admitted|discharged|issued|expires|expiry|appointment|visit|signed|created)\b/i)
  },
  {
    entityType: 'LOCATION',
    regex: /\b(Bengaluru|Bangalore|Mumbai|New Delhi|Delhi|Chennai|Hyderabad|Kolkata|Pune|Ahmedabad|Jaipur|Lucknow|Kochi|Chandigarh|Gurugram|Noida|Karnataka|Maharashtra|Tamil Nadu|Telangana|Gujarat|Rajasthan|Kerala|Uttar Pradesh|West Bengal|New York|London|Singapore|Toronto|Berlin|Munich|Sydney|Melbourne|Johannesburg|Seoul|Bangkok|Manila|Istanbul|Madrid|Rome|Warsaw|Helsinki|Stockholm|Lagos)\b/g,
    groupIndex: 1,
    score: 0.86,
    method: 'presidio-location',
    validate: (_val, t, s, e) => {
      // Avoid masking inside organization names like "State Bank of India" or "University of Delhi"
      const prefix = t.slice(Math.max(0, s - 20), s);
      if (/\b(?:Bank of|University of|Government of|IIT|IIM|AIIMS)\s*$/i.test(prefix)) return false;
      return hasContext(t, s, e, /\b(?:address|city|state|location|residence|resident|branch|office|born|lives|from|visiting|travel|clinic|hospital)\b/i, 85);
    }
  }
];
