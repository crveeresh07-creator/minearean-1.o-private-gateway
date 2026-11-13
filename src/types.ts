export type OutputFormat = 'pdf' | 'docx' | 'pptx' | 'txt' | 'xlsx';

export type TaskType = 'summarize' | 'extract' | 'audit' | 'process';

export type FileStage =
  | 'queued'
  | 'inspecting'
  | 'masked'
  | 'processing'
  | 'completed'
  | 'blocked'
  | 'error';

export interface LeakCheckResult {
  passed: boolean;
  leak_count: number;
  status: 'Leak Check Passed' | 'Leak Detected – Request Blocked';
  checks_performed: string[];
  violations?: Array<{
    token: string;
    reason: string;
    sample: string;
  }>;
}

export interface FileInspectResponse {
  success: boolean;
  blocked?: boolean;
  inspect_id?: string;
  document_name: string;
  file_format?: string;
  page_count?: number;
  ocr_used?: boolean;
  entity_counts?: Record<string, number>;
  total_detected?: number;
  masking_status?: string;
  file_status?: string;
  leak_check?: LeakCheckResult;
  sanitized_preview?: string;
  latency_ms?: number;
  error?: string;
}

export interface FileProcessResponse {
  success: boolean;
  doc_id?: string;
  document_name: string;
  file_format?: string;
  output_format?: OutputFormat;
  page_count?: number;
  ocr_used?: boolean;
  entity_counts?: Record<string, number>;
  total_detected?: number;
  masking_status?: string;
  leak_check?: LeakCheckResult;
  sanitized_outbound_payload?: string;
  sanitized_preview?: string;
  raw_ai_response?: string;
  restored_response?: string;
  external_llm?: string;
  latency_ms?: number;
  error?: string;
}

export interface QueuedFileItem {
  localId: string;
  file: File;
  stage: FileStage;
  statusLabel: string;
  inspectId?: string;
  entityCounts?: Record<string, number>;
  totalDetected?: number;
  result?: FileProcessResponse;
  error?: string;
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
