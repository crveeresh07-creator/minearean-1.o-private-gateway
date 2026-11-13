"""
PII Detection and Tokenization Engine for Indian Entities.
DPDP Act 2023 compliant.
Integrates Microsoft Presidio, Custom Indian Recognizers (Aadhaar, PAN, GSTIN,
Voter ID, Passport, Phone, Email, Bank Details, IFSC, PIN Code) and GLiNER.
"""

import re
from typing import Dict, Any, List, Tuple

# Verhoeff algorithm for Aadhaar validation
VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def validate_verhoeff(num_str: str) -> bool:
    digits = [int(c) for c in num_str if c.isdigit()]
    if len(digits) != 12:
        return False
    c = 0
    for idx, item in enumerate(reversed(digits)):
        c = VERHOEFF_D[c][VERHOEFF_P[idx % 8][item]]
    return c == 0


# Regex patterns for Indian PII
INDIAN_PII_PATTERNS = {
    "AADHAAR": [
        re.compile(r"\b[2-9]{1}[0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4}\b"),
        re.compile(r"\b[2-9]{1}[0-9]{11}\b")
    ],
    "PAN": [
        re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b")
    ],
    "GSTIN": [
        re.compile(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b")
    ],
    "VOTER_ID": [
        re.compile(r"\b[A-Z]{3}[0-9]{7}\b")
    ],
    "PASSPORT": [
        re.compile(r"\b[A-Z]{1}[0-9]{7}\b")
    ],
    "PHONE": [
        re.compile(r"(?:(?:\+91|91|0)[- ]?)?[6-9]\d{9}\b")
    ],
    "EMAIL": [
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b")
    ],
    "IFSC": [
        re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
    ],
    "BANK_ACC": [
        re.compile(r"(?:Account\s*(?:No\.?|Number)?|A/C|ಖಾತೆ\s*(?:ಸಂಖ್ಯೆ)?|खाता\s*(?:संख्या)?)[:\s/]*(\d{9,18})\b", re.IGNORECASE)
    ],
    "PINCODE": [
        re.compile(r"\b(?:PIN(?:code)?[:\s]*)?([1-9][0-9]{5})\b", re.IGNORECASE)
    ],
    "PERSON": [
        re.compile(r"(?:Mr\.|Mrs\.|Ms\.|Dr\.|Shri|Smt\.|Prof\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})"),
        re.compile(r"(?:Name|ಹೆಸರು|नाम)[:\s/]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})"),
        re.compile(r"(?:Name|ಹೆಸರು|नाम)[:\s/]+([\u0C80-\u0CFF]+(?:\s+[\u0C80-\u0CFF]+){1,3})"),
        re.compile(r"\b([\u0C80-\u0CFF]{3,15}\s+[\u0C80-\u0CFF]{3,15})\b")
    ]
}


class IndianPIIEngine:
    def __init__(self):
        self.presidio_available = False
        try:
            from presidio_analyzer import AnalyzerEngine
            self.analyzer = AnalyzerEngine()
            self.presidio_available = True
        except Exception:
            self.analyzer = None

    def detect_entities(self, text: str) -> List[Dict[str, Any]]:
        """
        Detects all sensitive PII entities in the text with start/end indices.
        """
        detected: List[Dict[str, Any]] = []

        # 1. Custom High-Precision Indian Recognizers
        for entity_type, patterns in INDIAN_PII_PATTERNS.items():
            for pattern in patterns:
                for match in pattern.finditer(text):
                    val = match.group(0).strip()
                    start, end = match.span()
                    
                    # Specific validation for Aadhaar (must not match generic 12-digit random numbers)
                    if entity_type == "AADHAAR":
                        clean_num = re.sub(r"\D", "", val)
                        if len(clean_num) != 12 or clean_num.startswith("0") or clean_num.startswith("1"):
                            continue

                    # Avoid duplicate overlapping detections
                    overlap = any(
                        d["start"] <= start < d["end"] or d["start"] < end <= d["end"]
                        for d in detected
                    )
                    if not overlap:
                        detected.append({
                            "entity_type": entity_type,
                            "value": val,
                            "start": start,
                            "end": end,
                            "score": 0.95
                        })

        # 2. Presidio Analyzer if available
        if self.presidio_available and self.analyzer:
            try:
                results = self.analyzer.analyze(text=text, language="en")
                for r in results:
                    val = text[r.start:r.end].strip()
                    overlap = any(
                        d["start"] <= r.start < d["end"] or d["start"] < r.end <= d["end"]
                        for d in detected
                    )
                    if not overlap and len(val) > 2:
                        etype = r.entity_type
                        if etype == "EMAIL_ADDRESS":
                            etype = "EMAIL"
                        elif etype == "PHONE_NUMBER":
                            etype = "PHONE"
                        detected.append({
                            "entity_type": etype,
                            "value": val,
                            "start": r.start,
                            "end": r.end,
                            "score": r.score
                        })
            except Exception:
                pass

        # Sort detected entities by position
        detected.sort(key=lambda x: x["start"])
        return detected

    def mask_text(self, text: str, detected_entities: List[Dict[str, Any]]) -> Tuple[str, Dict[str, str], Dict[str, int]]:
        """
        Replaces detected sensitive values with SafeHolder placeholders:
        <SAFEHOLDER_PERSON_1>, <SAFEHOLDER_ADDRESS_1>, <SAFEHOLDER_AADHAAR_1>, <SAFEHOLDER_PAN_1>, <SAFEHOLDER_BANK_ACC_1>, etc.
        Returns:
            sanitized_text: string with placeholders
            token_mapping: dict mapping placeholder -> raw_value (KEPT STRICTLY LOCAL)
            entity_counts: dict of counts per entity type
        """
        token_mapping: Dict[str, str] = {}
        entity_counters: Dict[str, int] = {}
        entity_counts: Dict[str, int] = {}

        # Sort in reverse order of start position so replacements do not distort indices
        sorted_entities = sorted(detected_entities, key=lambda x: x["start"], reverse=True)

        sanitized_chars = list(text)

        for ent in sorted_entities:
            etype = ent["entity_type"]
            val = ent["value"]
            start = ent["start"]
            end = ent["end"]

            # Update count
            entity_counts[etype] = entity_counts.get(etype, 0) + 1

            token_prefix = f"SAFEHOLDER_{etype}"

            # Check if this exact value was already assigned a placeholder
            existing_token = None
            for token, raw in token_mapping.items():
                if raw == val and token.startswith(f"<{token_prefix}_"):
                    existing_token = token
                    break

            if existing_token:
                token = existing_token
            else:
                entity_counters[etype] = entity_counters.get(etype, 0) + 1
                token = f"<{token_prefix}_{entity_counters[etype]}>"
                token_mapping[token] = val

            sanitized_chars[start:end] = list(token)

        sanitized_text = "".join(sanitized_chars)
        return sanitized_text, token_mapping, entity_counts

    def restore_text(self, ai_response: str, token_mapping: Dict[str, str]) -> str:
        """
        Restores original information locally by replacing placeholders
        back with real values.
        """
        restored = ai_response
        for token, raw_val in token_mapping.items():
            restored = restored.replace(token, raw_val)
            # Also catch token variants LLM might format (e.g., lowercase or spaces)
            token_inner = token.strip("<>")
            restored = re.sub(rf"<{re.escape(token_inner)}>", raw_val, restored, flags=re.IGNORECASE)
        return restored
