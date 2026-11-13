/**
 * DPDP-Compliant Audit History SQLite Store
 *
 * Records ONLY non-sensitive operational telemetry & the sanitized outbound payload:
 * - Uploaded document name
 * - Processing date and time
 * - Detected PII categories and counts
 * - Masking status
 * - Leak Check result
 * - Exact sanitized outbound payload (verified zero raw PII)
 * - External LLM used
 * - Processing status & latency
 *
 * NEVER stores original raw PII or original-to-placeholder mappings.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'audit.db');

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    document_name TEXT NOT NULL,
    file_format TEXT NOT NULL,
    output_format TEXT NOT NULL,
    entity_counts_json TEXT NOT NULL,
    total_entities INTEGER NOT NULL,
    masking_status TEXT NOT NULL,
    leak_check_status TEXT NOT NULL,
    sanitized_payload TEXT NOT NULL,
    external_llm TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    processing_status TEXT NOT NULL
  )
`);

export interface AuditRecordInput {
  documentName: string;
  fileFormat: string;
  outputFormat: string;
  entityCounts: Record<string, number>;
  totalEntities: number;
  maskingStatus: string;
  leakCheckStatus: string;
  sanitizedPayload: string;
  externalLlm: string;
  latencyMs: number;
  processingStatus: string;
}

export interface AuditRecord {
  id: number;
  timestamp: string;
  document_name: string;
  file_format: string;
  output_format: string;
  entity_counts: Record<string, number>;
  total_entities: number;
  masking_status: string;
  leak_check_status: string;
  sanitized_payload: string;
  external_llm: string;
  latency_ms: number;
  processing_status: string;
}

export function insertAuditRecord(entry: AuditRecordInput): number {
  const stmt = db.prepare(`
    INSERT INTO audit_records (
      timestamp, document_name, file_format, output_format,
      entity_counts_json, total_entities, masking_status,
      leak_check_status, sanitized_payload, external_llm,
      latency_ms, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    new Date().toISOString(),
    entry.documentName,
    entry.fileFormat,
    entry.outputFormat,
    JSON.stringify(entry.entityCounts),
    entry.totalEntities,
    entry.maskingStatus,
    entry.leakCheckStatus,
    entry.sanitizedPayload,
    entry.externalLlm,
    entry.latencyMs,
    entry.processingStatus
  );

  return Number(result.lastInsertRowid);
}

export function listAuditRecords(limit = 100): AuditRecord[] {
  const stmt = db.prepare('SELECT * FROM audit_records ORDER BY id DESC LIMIT ?');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = stmt.all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    document_name: row.document_name,
    file_format: row.file_format,
    output_format: row.output_format,
    entity_counts: JSON.parse(row.entity_counts_json || '{}'),
    total_entities: row.total_entities,
    masking_status: row.masking_status,
    leak_check_status: row.leak_check_status,
    sanitized_payload: row.sanitized_payload,
    external_llm: row.external_llm,
    latency_ms: row.latency_ms,
    processing_status: row.processing_status
  }));
}

export function clearAuditRecords(): void {
  db.exec('DELETE FROM audit_records');
}
