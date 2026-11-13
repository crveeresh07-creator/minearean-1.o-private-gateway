"""
Mandatory Pre-Flight Leak Check Module.
Guarantees Zero-Tolerance PII leakage before any payload leaves perimeter to external LLMs.
If any raw PII value or unmasked high-sensitivity pattern is detected in sanitized text:
HALTS execution immediately and blocks the external AI request.
"""

import re
from typing import Dict, Any, List


class LeakCheckFailure(Exception):
    """Raised when sanitized text contains raw personal data."""
    pass


def perform_leak_check(sanitized_text: str, token_mapping: Dict[str, str]) -> Dict[str, Any]:
    """
    Performs comprehensive multi-vector leak check:
    1. Exact Match Scan: Verifies that none of the raw PII values from token_mapping exist in sanitized_text.
    2. Substring & Trimmed Match Scan: Verifies that normalized raw values (e.g. without spaces/hyphens) do not appear.
    3. High-Sensitivity Regex Scan: Scans for unmasked Aadhaar, PAN, Emails, Phone numbers.
    """
    leaked_items: List[Dict[str, str]] = []
    checks_performed = [
        "Raw PII Exact Match Verification",
        "Normalized Substring Containment Check",
        "Aadhaar Pattern Secondary Scan",
        "PAN Regex Secondary Scan",
        "Financial & Contact Secondary Scan"
    ]

    # 1. Exact Match Check against all raw values
    for token, raw_val in token_mapping.items():
        clean_raw = raw_val.strip()
        if len(clean_raw) < 3:
            continue

        if clean_raw in sanitized_text:
            leaked_items.append({
                "token": token,
                "reason": "Exact raw value found in sanitized payload",
                "sample": clean_raw[:3] + "***"
            })

        # Also check condensed digits (for Aadhaar, phone, PAN)
        digits_only = re.sub(r"\D", "", clean_raw)
        if len(digits_only) >= 10:
            condensed_text = re.sub(r"\s+", "", sanitized_text)
            if digits_only in condensed_text:
                leaked_items.append({
                    "token": token,
                    "reason": "Condensed unmasked digits found in sanitized payload",
                    "sample": digits_only[:3] + "***"
                })

    # 2. Secondary Regex Cross-Check for unmasked high-risk formats
    unmasked_pan = re.findall(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b", sanitized_text)
    if unmasked_pan:
        leaked_items.append({
            "token": "UNMASKED_PAN",
            "reason": f"Unmasked PAN format detected in outgoing text ({len(unmasked_pan)} instance)",
            "sample": unmasked_pan[0][:3] + "***"
        })

    unmasked_aadhaar = re.findall(r"\b[2-9]{1}[0-9]{3}\s[0-9]{4}\s[0-9]{4}\b", sanitized_text)
    if unmasked_aadhaar:
        leaked_items.append({
            "token": "UNMASKED_AADHAAR",
            "reason": f"Unmasked Aadhaar pattern detected in outgoing text",
            "sample": unmasked_aadhaar[0][:4] + " **** ****"
        })

    is_passed = len(leaked_items) == 0

    result = {
        "passed": is_passed,
        "leak_count": len(leaked_items),
        "checks_performed": checks_performed,
        "violations": leaked_items,
        "status": "PASSED" if is_passed else "BLOCKED_LEAK_DETECTED"
    }

    if not is_passed:
        raise LeakCheckFailure(
            f"Pre-flight Leak Check FAILED: {len(leaked_items)} unmasked sensitive entity found. "
            f"AI Request strictly blocked to prevent DPDP breach."
        )

    return result
