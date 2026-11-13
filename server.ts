import 'dotenv/config';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import JSZip from 'jszip';

import {
  detectEntities,
  maskText,
  maskAndSanitize,
  restoreText,
  createBatchMaskContext,
  BatchMaskContext
} from './server/piiEngine';
import { performLeakCheck } from './server/leakCheck';
import { extractDocumentBuffer, getExtension, ExtractionResult } from './server/documentExtractor';
import { generateOutputFile, OutputFormat, ExportMetadata } from './server/documentGenerator';
import { buildOutboundPrompt, invokePluggableLLM } from './server/llmClient';
import { insertAuditRecord, listAuditRecords, clearAuditRecords } from './server/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Respect CLI --port, platform DEFAULT_APP_PORT, or standalone PORT (when nginx doesn't own PORT), defaulting to 3000
const portArgIdx = process.argv.indexOf('--port');
const cliPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : NaN;
const PORT =
  (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : 0) ||
  (process.env.DEFAULT_APP_PORT ? Number(process.env.DEFAULT_APP_PORT) : 0) ||
  (!process.env.NGINX_PORT && process.env.PORT ? Number(process.env.PORT) : 0) ||
  3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per file
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ephemeral local memory stores (NEVER persisted to disk or sent to external LLM)
interface StoredProcessedDoc {
  docId: string;
  restoredResponse: string;
  sanitizedOutboundPayload: string;
  sanitizedText: string;
  meta: ExportMetadata;
  createdAt: number;
}

interface StoredInspectedDoc {
  inspectId: string;
  filename: string;
  fileFormat: string;
  extraction: ExtractionResult;
  sanitizedText: string;
  tokenMapping: Record<string, string>;
  entityCounts: Record<string, number>;
  totalDetected: number;
  createdAt: number;
}

const processedDocs = new Map<string, StoredProcessedDoc>();
const inspectedDocs = new Map<string, StoredInspectedDoc>();
const batchContexts = new Map<string, { ctx: BatchMaskContext; createdAt: number }>();

// Periodically prune stale in-memory items older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, entry] of processedDocs.entries()) {
    if (entry.createdAt < cutoff) processedDocs.delete(id);
  }
  for (const [id, entry] of inspectedDocs.entries()) {
    if (entry.createdAt < cutoff) inspectedDocs.delete(id);
  }
  for (const [id, entry] of batchContexts.entries()) {
    if (entry.createdAt < cutoff) batchContexts.delete(id);
  }
}, 15 * 60 * 1000).unref();

function getOrCreateBatchContext(batchId?: string): BatchMaskContext | undefined {
  if (!batchId) return undefined;
  let existing = batchContexts.get(batchId);
  if (!existing) {
    existing = { ctx: createBatchMaskContext(), createdAt: Date.now() };
    batchContexts.set(batchId, existing);
  }
  return existing.ctx;
}

const VALID_OUTPUT_FORMATS = new Set<OutputFormat>(['pdf', 'docx', 'pptx', 'txt', 'xlsx']);

function normalizeOutputFormat(fmt?: string): OutputFormat {
  const lower = (fmt || 'pdf').toLowerCase() as OutputFormat;
  return VALID_OUTPUT_FORMATS.has(lower) ? lower : 'pdf';
}

// -------------------------------------------------------------
// Health Endpoint
// -------------------------------------------------------------
const handleHealth = (_req: Request, res: Response) => {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const hasLocalSlm = Boolean(process.env.LOCAL_SLM_URL);

  res.json({
    status: 'ok',
    service: 'Privacy Gateway – DPDP Enterprise AI Perimeter',
    version: '2.0.0',
    llm_configured: hasGeminiKey || hasLocalSlm,
    primary_model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    supported_input_formats: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'],
    supported_output_formats: ['pdf', 'docx', 'pptx', 'txt', 'xlsx'],
    recognizers: [
      'INDIA: AADHAAR (Verhoeff), PAN, GSTIN, VOTER_ID, PASSPORT, VEHICLE_REG, PHONE, BANK_ACC, IFSC, UPI_ID, PINCODE, PERSON, ADDRESS',
      'GLOBAL: CREDIT_CARD (Luhn), CRYPTO, DATE_TIME, EMAIL, IBAN_CODE (Mod-97), IP_ADDRESS, MAC_ADDRESS, NRP, LOCATION, URL, UUID, MEDICAL_LICENSE',
      'REGIONAL (18 Countries): USA (SSN/ITIN/NPI/MBI), UK (NINO/NHS/Postcode), ES, IT, PL, SG, AU, FI, KR, NG, PH, CA, SE, ZA, TH, TR, DE',
      'MEDICAL / CLINICAL: Disease/Disorder, Medication, Procedure, Clinical Event, Biological Attribute, Anatomy, Medical History'
    ]
  });
};

app.get('/health', handleHealth);
app.get('/api/health', handleHealth);

function parseBooleanFlag(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
  return false;
}

// -------------------------------------------------------------
// Pre-Processing File Inspection & Masking Endpoint
// UPLOAD -> EXTRACT -> DETECT -> MASK -> VERIFY -> READY (or BLOCK if strict)
// -------------------------------------------------------------
app.post('/api/gateway/inspect-file', upload.single('file'), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const filename = req.file?.originalname || 'document.txt';
  const fileFormat = getExtension(filename) || 'unknown';
  const batchId = req.body?.batchId ? String(req.body.batchId) : undefined;
  const blockOnDetection = parseBooleanFlag(req.body?.blockOnDetection);

  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        document_name: filename,
        error: `File '${filename}' is empty or missing.`
      });
    }

    // 1. Extract readable content
    const extraction = await extractDocumentBuffer(req.file.buffer, filename);

    // 2. Detect PII & run full two-pass masking (Mask Instead of Block)
    const batchCtx = getOrCreateBatchContext(batchId);
    const { sanitizedText, tokenMapping, entityCounts } = maskAndSanitize(extraction.text, batchCtx);
    const totalDetected = Object.values(entityCounts).reduce((a, b) => a + b, 0);
    const maskingStatus = totalDetected > 0 ? 'MASKED' : 'NO_PII_DETECTED';

    // 3. Verify sanitized text has zero raw PII
    const leakCheck = performLeakCheck(sanitizedText, tokenMapping);
    const latencyMs = Date.now() - startTime;

    // Only hard-block if strict 'Block on Detection' is enabled OR masking pipeline failed
    if (blockOnDetection && totalDetected > 0) {
      insertAuditRecord({
        documentName: filename,
        fileFormat,
        outputFormat: 'pdf',
        entityCounts,
        totalEntities: totalDetected,
        maskingStatus: 'BLOCKED_STRICT_POLICY',
        leakCheckStatus: 'Leak Detected – Request Blocked',
        sanitizedPayload: '[BLOCKED BY STRICT POLICY BEFORE PROCESSING]',
        externalLlm: 'none (inspection)',
        latencyMs,
        processingStatus: 'Blocked'
      });

      return res.status(400).json({
        success: false,
        blocked: true,
        document_name: filename,
        entity_counts: entityCounts,
        total_detected: totalDetected,
        masking_status: 'BLOCKED_STRICT_POLICY',
        file_status: 'Leak Detected – Request Blocked',
        leak_check: {
          ...leakCheck,
          passed: false,
          status: 'Leak Detected – Request Blocked'
        },
        error: `Strict 'Block on Detection' enabled: ${totalDetected} sensitive PII entities detected and blocked.`
      });
    }

    if (!leakCheck.passed) {
      insertAuditRecord({
        documentName: filename,
        fileFormat,
        outputFormat: 'pdf',
        entityCounts,
        totalEntities: totalDetected,
        maskingStatus: 'MASKING_FAILED',
        leakCheckStatus: leakCheck.status,
        sanitizedPayload: '[BLOCKED — MASKING PIPELINE VERIFICATION FAILED]',
        externalLlm: 'none (inspection)',
        latencyMs,
        processingStatus: 'Blocked'
      });

      return res.status(400).json({
        success: false,
        blocked: true,
        document_name: filename,
        entity_counts: entityCounts,
        total_detected: totalDetected,
        leak_check: leakCheck,
        error: 'Masking pipeline verification failed: residual raw PII could not be redacted.'
      });
    }

    const inspectId = crypto.randomUUID();
    inspectedDocs.set(inspectId, {
      inspectId,
      filename,
      fileFormat,
      extraction,
      sanitizedText,
      tokenMapping,
      entityCounts,
      totalDetected,
      createdAt: Date.now()
    });

    const fileStatus = totalDetected > 0
      ? 'PII Masked – Ready to Process'
      : 'No PII Detected – Ready to Process';

    // Log detected PII entity types for audit compliance
    insertAuditRecord({
      documentName: filename,
      fileFormat,
      outputFormat: 'pending',
      entityCounts,
      totalEntities: totalDetected,
      maskingStatus,
      leakCheckStatus: leakCheck.status,
      sanitizedPayload: sanitizedText,
      externalLlm: 'local-masking-only',
      latencyMs,
      processingStatus: fileStatus
    });

    return res.json({
      success: true,
      blocked: false,
      inspect_id: inspectId,
      document_name: filename,
      file_format: fileFormat,
      page_count: extraction.page_count,
      ocr_used: extraction.ocr_used,
      entity_counts: entityCounts,
      total_detected: totalDetected,
      masking_status: maskingStatus,
      file_status: fileStatus,
      leak_check: leakCheck,
      sanitized_preview: sanitizedText,
      latency_ms: latencyMs
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    insertAuditRecord({
      documentName: filename,
      fileFormat,
      outputFormat: 'pending',
      entityCounts: {},
      totalEntities: 0,
      maskingStatus: 'FAILED',
      leakCheckStatus: 'Not Executed',
      sanitizedPayload: '',
      externalLlm: 'local-masking-only',
      latencyMs,
      processingStatus: 'Masking Failed'
    });

    return res.status(400).json({
      success: false,
      document_name: filename,
      error: errorMsg
    });
  }
});

// -------------------------------------------------------------
// End-to-End Single-File Gateway Pipeline
// UPLOAD -> EXTRACT -> DETECT -> MASK -> LEAK CHECK -> LLM -> RESTORE -> AUDIT
// -------------------------------------------------------------
app.post('/api/gateway/process-file', upload.single('file'), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const inspectId = req.body?.inspectId ? String(req.body.inspectId) : undefined;
  const cachedInspection = inspectId ? inspectedDocs.get(inspectId) : undefined;
  const filename = req.file?.originalname || cachedInspection?.filename || 'document.txt';
  const fileFormat = getExtension(filename) || cachedInspection?.fileFormat || 'unknown';
  const outputFormat = normalizeOutputFormat(req.body?.outputFormat);
  const task = String(req.body?.task || 'summarize');
  const customPrompt = req.body?.customPrompt ? String(req.body.customPrompt) : undefined;
  const batchId = req.body?.batchId ? String(req.body.batchId) : undefined;
  const provider = req.body?.provider === 'local-slm' ? 'local-slm' : 'gemini';
  const blockOnDetection = parseBooleanFlag(req.body?.blockOnDetection);

  try {
    let extraction: ExtractionResult;
    let sanitizedText: string;
    let tokenMapping: Record<string, string>;
    let entityCounts: Record<string, number>;

    if (cachedInspection) {
      extraction = cachedInspection.extraction;
      sanitizedText = cachedInspection.sanitizedText;
      tokenMapping = cachedInspection.tokenMapping;
      entityCounts = cachedInspection.entityCounts;
    } else {
      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({
          success: false,
          document_name: filename,
          error: `File '${filename}' is empty or missing.`
        });
      }

      // 1. Extract readable content & structure
      extraction = await extractDocumentBuffer(req.file.buffer, filename);

      // 2 & 3. Detect PII & run full two-pass SafeHolder masking (Mask Instead of Block)
      const batchCtx = getOrCreateBatchContext(batchId);
      const masked = maskAndSanitize(extraction.text, batchCtx);
      sanitizedText = masked.sanitizedText;
      tokenMapping = masked.tokenMapping;
      entityCounts = masked.entityCounts;
    }

    const totalDetected = Object.values(entityCounts).reduce((a, b) => a + b, 0);
    const maskingStatus = totalDetected > 0 ? 'MASKED' : 'NO_PII_DETECTED';

    // Strict override: hard-block only if Block on Detection toggle is explicitly enabled
    if (blockOnDetection && totalDetected > 0) {
      const latencyMs = Date.now() - startTime;
      insertAuditRecord({
        documentName: filename,
        fileFormat,
        outputFormat,
        entityCounts,
        totalEntities: totalDetected,
        maskingStatus: 'BLOCKED_STRICT_POLICY',
        leakCheckStatus: 'Leak Detected – Request Blocked',
        sanitizedPayload: '[BLOCKED BY STRICT POLICY BEFORE TRANSMISSION]',
        externalLlm: provider === 'local-slm' ? 'local-slm' : (process.env.GEMINI_MODEL || 'gemini-3.8-flash'),
        latencyMs,
        processingStatus: 'Blocked'
      });

      return res.status(400).json({
        success: false,
        document_name: filename,
        leak_check: {
          passed: false,
          leak_count: totalDetected,
          status: 'Leak Detected – Request Blocked',
          checks_performed: ['Strict Block on Detection Policy']
        },
        entity_counts: entityCounts,
        total_detected: totalDetected,
        error: `Strict 'Block on Detection' enabled: ${totalDetected} sensitive PII entities detected and blocked.`
      });
    }

    // 4. Construct complete outbound LLM prompt & verify sanitized payload (+ customPrompt) has zero raw PII
    const outboundPayload = buildOutboundPrompt(sanitizedText, task, customPrompt);
    const textToVerify = customPrompt ? `${sanitizedText}\n${customPrompt}` : sanitizedText;
    const leakCheck = performLeakCheck(textToVerify, tokenMapping);

    if (!leakCheck.passed) {
      const latencyMs = Date.now() - startTime;
      insertAuditRecord({
        documentName: filename,
        fileFormat,
        outputFormat,
        entityCounts,
        totalEntities: totalDetected,
        maskingStatus: 'MASKING_FAILED',
        leakCheckStatus: leakCheck.status,
        sanitizedPayload: '[BLOCKED BEFORE TRANSMISSION]',
        externalLlm: provider === 'local-slm' ? 'local-slm' : (process.env.GEMINI_MODEL || 'gemini-3.8-flash'),
        latencyMs,
        processingStatus: 'Blocked'
      });

      return res.status(400).json({
        success: false,
        document_name: filename,
        leak_check: leakCheck,
        entity_counts: entityCounts,
        total_detected: totalDetected,
        error: 'Leak Detected – Request Blocked. Masking pipeline failed to eliminate all raw sensitive data.'
      });
    }

    // 5. Send ONLY sanitized payload to External LLM
    const llmResult = await invokePluggableLLM({
      sanitizedText,
      task,
      customPrompt,
      provider
    });

    // 6. Restore original values locally using verified local mapping
    const restoredResponse = restoreText(llmResult.rawAiResponse, tokenMapping);
    const latencyMs = Date.now() - startTime;

    // 7. Store processed doc ephemerally in local memory for instant format export
    const docId = crypto.randomUUID();
    const meta: ExportMetadata = {
      originalFilename: filename,
      leakCheckStatus: leakCheck.status,
      entitiesMasked: totalDetected,
      entityCounts,
      llmUsed: llmResult.modelUsed,
      processedAt: new Date().toISOString()
    };
    processedDocs.set(docId, {
      docId,
      restoredResponse,
      sanitizedOutboundPayload: llmResult.outboundPrompt,
      sanitizedText,
      meta,
      createdAt: Date.now()
    });

    // 8. Record Safe Audit History (ZERO raw PII, includes exact sanitized outbound payload)
    insertAuditRecord({
      documentName: filename,
      fileFormat,
      outputFormat,
      entityCounts,
      totalEntities: totalDetected,
      maskingStatus,
      leakCheckStatus: leakCheck.status,
      sanitizedPayload: llmResult.outboundPrompt,
      externalLlm: llmResult.modelUsed,
      latencyMs,
      processingStatus: 'Completed'
    });

    return res.json({
      success: true,
      doc_id: docId,
      document_name: filename,
      file_format: fileFormat,
      output_format: outputFormat,
      page_count: extraction.page_count,
      ocr_used: extraction.ocr_used,
      entity_counts: entityCounts,
      total_detected: totalDetected,
      masking_status: maskingStatus,
      leak_check: leakCheck,
      sanitized_outbound_payload: llmResult.outboundPrompt,
      sanitized_preview: sanitizedText,
      raw_ai_response: llmResult.rawAiResponse,
      restored_response: restoredResponse,
      external_llm: llmResult.modelUsed,
      latency_ms: latencyMs
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    insertAuditRecord({
      documentName: filename,
      fileFormat,
      outputFormat,
      entityCounts: {},
      totalEntities: 0,
      maskingStatus: 'FAILED',
      leakCheckStatus: 'Not Executed',
      sanitizedPayload: '',
      externalLlm: provider === 'local-slm' ? 'local-slm' : (process.env.GEMINI_MODEL || 'gemini-3.8-flash'),
      latencyMs,
      processingStatus: 'Error'
    });

    return res.status(502).json({
      success: false,
      document_name: filename,
      error: errorMsg
    });
  }
});

// -------------------------------------------------------------
// Text-only Processing Endpoint (used by automated benchmark & API clients)
// -------------------------------------------------------------
app.post('/api/process', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const {
    text,
    task = 'summarize',
    customPrompt,
    document_name = 'Document.txt',
    provider = 'gemini',
    skip_llm = false
  } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ detail: 'Document text cannot be empty.' });
  }

  try {
    const { sanitizedText, tokenMapping, entityCounts, detectedEntities: detected } = maskAndSanitize(text);
    const totalDetected = Object.values(entityCounts).reduce((a, b) => a + b, 0);

    const textToVerify = customPrompt ? `${sanitizedText}\n${customPrompt}` : sanitizedText;
    const leakCheck = performLeakCheck(textToVerify, tokenMapping);

    if (!leakCheck.passed) {
      const latencyMs = Date.now() - startTime;
      insertAuditRecord({
        documentName: document_name,
        fileFormat: 'text',
        outputFormat: 'txt',
        entityCounts,
        totalEntities: totalDetected,
        maskingStatus: totalDetected > 0 ? 'MASKED' : 'NO_PII_DETECTED',
        leakCheckStatus: leakCheck.status,
        sanitizedPayload: '[BLOCKED BEFORE TRANSMISSION]',
        externalLlm: provider,
        latencyMs,
        processingStatus: 'Blocked'
      });
      return res.status(400).json({
        detail: 'Leak Detected – Request Blocked',
        leak_check: leakCheck
      });
    }

    if (skip_llm) {
      const restored = restoreText(sanitizedText, tokenMapping);
      return res.json({
        success: true,
        document_name,
        detected_entities: detected,
        entity_counts: entityCounts,
        total_detected: totalDetected,
        sanitized_text: sanitizedText,
        token_mapping: tokenMapping,
        leak_check: leakCheck,
        restored_response: restored,
        latency_ms: Date.now() - startTime
      });
    }

    const llmResult = await invokePluggableLLM({
      sanitizedText,
      task,
      customPrompt,
      provider
    });
    const restoredResponse = restoreText(llmResult.rawAiResponse, tokenMapping);
    const latencyMs = Date.now() - startTime;

    insertAuditRecord({
      documentName: document_name,
      fileFormat: 'text',
      outputFormat: 'txt',
      entityCounts,
      totalEntities: totalDetected,
      maskingStatus: totalDetected > 0 ? 'MASKED' : 'NO_PII_DETECTED',
      leakCheckStatus: leakCheck.status,
      sanitizedPayload: llmResult.outboundPrompt,
      externalLlm: llmResult.modelUsed,
      latencyMs,
      processingStatus: 'Completed'
    });

    return res.json({
      success: true,
      document_name,
      detected_entities: detected,
      entity_counts: entityCounts,
      total_detected: totalDetected,
      sanitized_text: sanitizedText,
      outbound_payload: llmResult.outboundPrompt,
      leak_check: leakCheck,
      raw_ai_response: llmResult.rawAiResponse,
      restored_response: restoredResponse,
      external_llm: llmResult.modelUsed,
      latency_ms: latencyMs
    });
  } catch (err: unknown) {
    return res.status(502).json({
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

// -------------------------------------------------------------
// Export / Download Endpoints (PDF, DOCX, PPTX, TXT, XLSX, Batch ZIP)
// -------------------------------------------------------------
function safeDownloadBasename(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${base || 'processed'}_privacy_gateway`;
}

app.get('/api/export/:docId', async (req: Request, res: Response) => {
  try {
    const doc = processedDocs.get(String(req.params.docId));
    if (!doc) {
      return res.status(404).json({ detail: 'Processed document session expired or not found.' });
    }
    const format = normalizeOutputFormat(String(req.query.format || 'pdf'));
    const variant = String(req.query.variant || 'sanitized').toLowerCase() === 'restored' ? 'restored' : 'sanitized';
    const exportContent =
      variant === 'restored'
        ? doc.restoredResponse
        : doc.sanitizedOutboundPayload || doc.sanitizedText || doc.restoredResponse;
    const generated = await generateOutputFile(exportContent, format, doc.meta);
    const outName = `${safeDownloadBasename(doc.meta.originalFilename)}.${generated.extension}`;

    res.setHeader('Content-Type', generated.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    return res.send(generated.buffer);
  } catch (err: unknown) {
    return res.status(500).json({ detail: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

app.post('/api/export', async (req: Request, res: Response) => {
  try {
    const { content, format = 'pdf', metadata } = req.body || {};
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ detail: 'Missing export content.' });
    }
    const normFormat = normalizeOutputFormat(String(format));
    const meta: ExportMetadata = {
      originalFilename: metadata?.originalFilename || 'Processed_Document',
      leakCheckStatus: metadata?.leakCheckStatus || 'Leak Check Passed',
      entitiesMasked: Number(metadata?.entitiesMasked || 0),
      entityCounts: metadata?.entityCounts || {},
      llmUsed: metadata?.llmUsed || 'gemini-3.8-flash',
      processedAt: metadata?.processedAt || new Date().toISOString()
    };

    const generated = await generateOutputFile(content, normFormat, meta);
    const outName = `${safeDownloadBasename(meta.originalFilename)}.${generated.extension}`;
    res.setHeader('Content-Type', generated.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    return res.send(generated.buffer);
  } catch (err: unknown) {
    return res.status(500).json({ detail: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

app.post('/api/export-batch', async (req: Request, res: Response) => {
  try {
    const { items, format = 'pdf', variant = 'sanitized' } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: 'No processed documents provided for batch download.' });
    }
    const normFormat = normalizeOutputFormat(String(format));
    const exportVariant = String(variant).toLowerCase() === 'restored' ? 'restored' : 'sanitized';
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const item of items) {
      const stored = item.docId ? processedDocs.get(String(item.docId)) : undefined;
      const content =
        item.content ||
        (exportVariant === 'restored'
          ? stored?.restoredResponse
          : stored?.sanitizedOutboundPayload || stored?.sanitizedText) ||
        stored?.restoredResponse;
      const meta: ExportMetadata = stored?.meta || {
        originalFilename: item.originalFilename || 'Document',
        leakCheckStatus: item.leakCheckStatus || 'Leak Check Passed',
        entitiesMasked: Number(item.entitiesMasked || 0),
        entityCounts: item.entityCounts || {},
        llmUsed: item.llmUsed || 'gemini-3.8-flash',
        processedAt: item.processedAt || new Date().toISOString()
      };
      if (!content) continue;

      const generated = await generateOutputFile(content, normFormat, meta);
      let candidateName = `${safeDownloadBasename(meta.originalFilename)}.${generated.extension}`;
      let counter = 2;
      while (usedNames.has(candidateName)) {
        candidateName = `${safeDownloadBasename(meta.originalFilename)}_${counter}.${generated.extension}`;
        counter++;
      }
      usedNames.add(candidateName);
      zip.file(candidateName, generated.buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Privacy_Gateway_Outputs_${normFormat.toUpperCase()}.zip"`);
    return res.send(zipBuffer);
  } catch (err: unknown) {
    return res.status(500).json({ detail: `Batch export failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// -------------------------------------------------------------
// Audit History Endpoints
// -------------------------------------------------------------
const handleAuditGet = (_req: Request, res: Response) => {
  try {
    const logs = listAuditRecords(100);
    res.json({ status: 'success', logs });
  } catch (err: unknown) {
    res.status(500).json({ detail: `Failed to fetch audit logs: ${err instanceof Error ? err.message : String(err)}` });
  }
};

app.get('/audit', handleAuditGet);
app.get('/api/audit', handleAuditGet);

app.delete('/api/audit', (_req: Request, res: Response) => {
  try {
    clearAuditRecords();
    res.json({ status: 'success', message: 'Audit history cleared.' });
  } catch (err: unknown) {
    res.status(500).json({ detail: `Failed to clear audit history: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// Prevent unhandled /api routes from hitting Vite HTML fallback
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/audit') {
    return res.status(404).json({ detail: `API endpoint '${req.method} ${req.path}' not found.` });
  }
  next();
});

// API Error Handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, req: Request, res: Response, next: any) => {
  if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/audit') {
    const msg = err?.message || 'Internal server error';
    return res.status(err?.status || 500).json({
      success: false,
      error: msg,
      detail: msg
    });
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Privacy Gateway Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
