import { AuditRecord, FileInspectResponse, FileProcessResponse, OutputFormat, TaskType } from '../types';

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const raw = await res.text();
  if (raw.trim().startsWith('<!doctype') || raw.trim().startsWith('<html')) {
    throw new Error(`Server returned HTML instead of JSON (HTTP ${res.status}).`);
  }
  const parsed = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    throw new Error(parsed.error || parsed.detail || `Request failed (HTTP ${res.status})`);
  }
  return parsed as T;
}

export async function inspectSingleFile(params: {
  file: File;
  batchId: string;
  blockOnDetection?: boolean;
}): Promise<FileInspectResponse> {
  const formData = new FormData();
  formData.append('file', params.file, params.file.name);
  formData.append('batchId', params.batchId);
  formData.append('blockOnDetection', String(Boolean(params.blockOnDetection)));

  const res = await fetch('/api/gateway/inspect-file', {
    method: 'POST',
    body: formData
  });

  const raw = await res.text();
  if (raw.trim().startsWith('<!doctype') || raw.trim().startsWith('<html')) {
    throw new Error(`Backend returned an HTML fallback page (HTTP ${res.status}).`);
  }

  const data = (raw ? JSON.parse(raw) : {}) as FileInspectResponse;
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Inspection failed (HTTP ${res.status})`) as Error & {
      responsePayload?: FileInspectResponse;
    };
    err.responsePayload = data;
    throw err;
  }

  return data;
}

export async function processSingleFile(params: {
  file: File;
  outputFormat: OutputFormat;
  task: TaskType;
  customPrompt?: string;
  batchId: string;
  inspectId?: string;
  blockOnDetection?: boolean;
}): Promise<FileProcessResponse> {
  const formData = new FormData();
  formData.append('file', params.file, params.file.name);
  formData.append('outputFormat', params.outputFormat);
  formData.append('task', params.task);
  formData.append('batchId', params.batchId);
  formData.append('blockOnDetection', String(Boolean(params.blockOnDetection)));
  if (params.inspectId) {
    formData.append('inspectId', params.inspectId);
  }
  if (params.customPrompt && params.customPrompt.trim()) {
    formData.append('customPrompt', params.customPrompt.trim());
  }

  const res = await fetch('/api/gateway/process-file', {
    method: 'POST',
    body: formData
  });

  const raw = await res.text();
  if (raw.trim().startsWith('<!doctype') || raw.trim().startsWith('<html')) {
    throw new Error(`Backend returned an HTML fallback page (HTTP ${res.status}).`);
  }

  const data = (raw ? JSON.parse(raw) : {}) as FileProcessResponse;
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Processing failed (HTTP ${res.status})`) as Error & {
      responsePayload?: FileProcessResponse;
    };
    err.responsePayload = data;
    throw err;
  }

  return data;
}

export async function downloadConvertedFile(params: {
  docId?: string;
  content: string;
  format: OutputFormat;
  variant?: 'sanitized' | 'restored';
  originalFilename: string;
  leakCheckStatus: string;
  entitiesMasked: number;
  entityCounts: Record<string, number>;
  llmUsed: string;
}): Promise<void> {
  const variant = params.variant || 'sanitized';
  let res: Response;

  if (params.docId) {
    res = await fetch(
      `/api/export/${encodeURIComponent(params.docId)}?format=${encodeURIComponent(params.format)}&variant=${encodeURIComponent(variant)}`
    );
    if (!res.ok && res.status === 404) {
      // Fallback to stateless export if ephemeral memory rotated
      res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: params.content,
          format: params.format,
          metadata: {
            originalFilename: params.originalFilename,
            leakCheckStatus: params.leakCheckStatus,
            entitiesMasked: params.entitiesMasked,
            entityCounts: params.entityCounts,
            llmUsed: params.llmUsed,
            processedAt: new Date().toISOString()
          }
        })
      });
    }
  } else {
    res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: params.content,
        format: params.format,
        metadata: {
          originalFilename: params.originalFilename,
          leakCheckStatus: params.leakCheckStatus,
          entitiesMasked: params.entitiesMasked,
          entityCounts: params.entityCounts,
          llmUsed: params.llmUsed,
          processedAt: new Date().toISOString()
        }
      })
    });
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    const text = await res.text();
    throw new Error(`Download failed: ${text.slice(0, 200)}`);
  }

  const blob = await res.blob();
  const base = params.originalFilename.replace(/\.[^/.]+$/, '');
  const suffix = variant === 'restored' ? 'restored' : 'sanitized';
  const filename = `${base}_${suffix}.${params.format}`;
  triggerBrowserDownload(blob, filename);
}

export async function downloadBatchZip(
  items: Array<{
    docId?: string;
    content: string;
    originalFilename: string;
    leakCheckStatus: string;
    entitiesMasked: number;
    entityCounts: Record<string, number>;
    llmUsed: string;
  }>,
  format: OutputFormat,
  variant: 'sanitized' | 'restored' = 'sanitized'
): Promise<void> {
  const res = await fetch('/api/export-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, format, variant })
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    const text = await res.text();
    throw new Error(`Batch download failed: ${text.slice(0, 200)}`);
  }

  const blob = await res.blob();
  triggerBrowserDownload(blob, `Privacy_Gateway_Batch_${format.toUpperCase()}.zip`);
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function fetchAuditHistory(): Promise<AuditRecord[]> {
  const res = await fetch('/api/audit');
  const data = await parseJsonSafe<{ status: string; logs: AuditRecord[] }>(res);
  return data.logs || [];
}

export async function clearAuditHistory(): Promise<void> {
  const res = await fetch('/api/audit', { method: 'DELETE' });
  await parseJsonSafe<{ status: string }>(res);
}
