"""
Safe SQLite Audit History Module for DPDP Compliance.
CRITICAL DPDP REQUIREMENT:
NEVER stores raw personal identifiable information (PII) or token mapping dictionaries.
Stores ONLY anonymized telemetry: document name, language, entity counts, leak check status,
AI provider, latency, and operational status.
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import Dict, Any, List

DB_PATH = os.path.join(os.path.dirname(__file__), "privacy_audit.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            document_name TEXT NOT NULL,
            language TEXT NOT NULL,
            task TEXT NOT NULL,
            entity_counts_json TEXT NOT NULL,
            total_entities INTEGER NOT NULL,
            leak_check_status TEXT NOT NULL,
            ai_provider TEXT NOT NULL,
            latency_ms INTEGER NOT NULL,
            status TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def record_audit(
    document_name: str,
    language: str,
    task: str,
    entity_counts: Dict[str, int],
    leak_check_status: str,
    ai_provider: str,
    latency_ms: int,
    status: str
) -> int:
    """
    Safely logs an audit record.
    Notice: No raw PII or token mappings are accepted or stored!
    """
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    total_entities = sum(entity_counts.values()) if entity_counts else 0
    now_iso = datetime.utcnow().isoformat() + "Z"

    cursor.execute("""
        INSERT INTO audit_logs (
            timestamp, document_name, language, task,
            entity_counts_json, total_entities, leak_check_status,
            ai_provider, latency_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        now_iso,
        document_name,
        language,
        task,
        json.dumps(entity_counts),
        total_entities,
        leak_check_status,
        ai_provider,
        latency_ms,
        status
    ))

    record_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return record_id


def get_audit_logs(limit: int = 100) -> List[Dict[str, Any]]:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM audit_logs
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))

    rows = cursor.fetchall()
    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            "timestamp": row["timestamp"],
            "document_name": row["document_name"],
            "language": row["language"],
            "task": row["task"],
            "entity_counts": json.loads(row["entity_counts_json"]),
            "total_entities": row["total_entities"],
            "leak_check_status": row["leak_check_status"],
            "ai_provider": row["ai_provider"],
            "latency_ms": row["latency_ms"],
            "status": row["status"]
        })

    conn.close()
    return results


def clear_audit_logs() -> bool:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM audit_logs")
    conn.commit()
    conn.close()
    return True
