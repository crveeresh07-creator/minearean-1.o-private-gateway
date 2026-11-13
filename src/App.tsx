import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Archive
} from 'lucide-react';
import {
  AuditRecord,
  OutputFormat,
  QueuedFileItem,
  TaskType
} from './types';
import {
  inspectSingleFile,
  processSingleFile,
  downloadConvertedFile,
  downloadBatchZip,
  fetchAuditHistory,
  clearAuditHistory
} from './services/api';
import { AuditHistorySection } from './components/AuditHistorySection';

const OUTPUT_FORMATS: Array<{ value: OutputFormat; label: string }> = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'pptx', label: 'PPTX' },
  { value: 'txt', label: 'TXT' },
  { value: 'xlsx', label: 'XLSX' }
];

const TASK_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: 'summarize', label: 'Summarize' },
  { value: 'extract', label: 'Extract Key Info' },
  { value: 'audit', label: 'DPDP Compliance Check' },
  { value: 'process', label: 'Custom Prompt' }
];

const ACCEPTED_EXTENSIONS = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.xls,.xlsx,.jpg,.jpeg,.png';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<QueuedFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('pdf');
  const [task, setTask] = useState<TaskType>('summarize');
  const [customPrompt, setCustomPrompt] = useState('');
  const [blockOnDetection, setBlockOnDetection] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  // Expanded preview & per-file format overrides in Download section
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'restored' | 'sanitized'>('restored');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingBatch, setDownloadingBatch] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Audit history state
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const logs = await fetchAuditHistory();
      setAuditLogs(logs);
    } catch {
      // keep silent if initial load fails
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const addFilesToQueue = async (fileList: FileList | File[]) => {
    setActionError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const inspectBatchId = crypto.randomUUID();
    const newItems: QueuedFileItem[] = incoming.map(file => ({
      localId: crypto.randomUUID(),
      file,
      stage: 'inspecting',
      statusLabel: 'Inspecting & masking PII...'
    }));

    setQueue(prev => [...prev, ...newItems]);

    // Immediately run local PII inspection & SafeHolder masking on upload (Mask Instead of Block)
    await Promise.allSettled(
      newItems.map(async item => {
        try {
          const inspected = await inspectSingleFile({
            file: item.file,
            batchId: inspectBatchId,
            blockOnDetection
          });

          setQueue(prev =>
            prev.map(q =>
              q.localId === item.localId
                ? {
                    ...q,
                    stage: 'masked',
                    statusLabel:
                      inspected.file_status ||
                      ((inspected.total_detected || 0) > 0
                        ? 'PII Masked – Ready to Process'
                        : 'No PII Detected – Ready to Process'),
                    inspectId: inspected.inspect_id,
                    entityCounts: inspected.entity_counts,
                    totalDetected: inspected.total_detected,
                    error: undefined
                  }
                : q
            )
          );
        } catch (err: unknown) {
          const errorObj = err as Error & { responsePayload?: { blocked?: boolean; leak_check?: { passed: boolean }; entity_counts?: Record<string, number>; total_detected?: number } };
          const isBlocked = Boolean(errorObj.responsePayload?.blocked) || errorObj.message.includes('Block on Detection') || errorObj.message.includes('Leak Detected');

          setQueue(prev =>
            prev.map(q =>
              q.localId === item.localId
                ? {
                    ...q,
                    stage: isBlocked ? 'blocked' : 'error',
                    statusLabel: isBlocked ? 'Leak Detected – Request Blocked' : 'Masking Failed',
                    entityCounts: errorObj.responsePayload?.entity_counts,
                    totalDetected: errorObj.responsePayload?.total_detected,
                    error: errorObj.message
                  }
                : q
            )
          );
        }
      })
    );

    loadAudit();
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
    }
    // Always reset input value so the user can re-upload the exact same file anytime
    e.target.value = '';
  };

  const removeQueueItem = (localId: string) => {
    setQueue(prev => prev.filter(item => item.localId !== localId));
  };

  const clearQueue = () => {
    if (isProcessingBatch) return;
    setQueue([]);
    setExpandedDocId(null);
    setActionError(null);
  };

  const handleIdentifyAndProcess = async () => {
    const targetItems = queue.filter(
      item =>
        item.stage === 'queued' ||
        item.stage === 'masked' ||
        item.stage === 'error' ||
        (!blockOnDetection && item.stage === 'blocked')
    );
    const itemsToRun = targetItems.length > 0 ? targetItems : queue.filter(item => !(blockOnDetection && item.stage === 'blocked'));
    if (itemsToRun.length === 0 || isProcessingBatch) return;

    setActionError(null);
    setIsProcessingBatch(true);
    const batchId = crypto.randomUUID();

    // Mark selected items as processing
    const idsToRun = new Set(itemsToRun.map(i => i.localId));
    setQueue(prev =>
      prev.map(item =>
        idsToRun.has(item.localId)
          ? {
              ...item,
              stage: 'processing',
              statusLabel: 'Sending sanitized content to AI · Restoring locally...',
              error: undefined
            }
          : item
      )
    );

    // Process all files independently and in parallel
    await Promise.allSettled(
      itemsToRun.map(async item => {
        try {
          const result = await processSingleFile({
            file: item.file,
            outputFormat,
            task,
            customPrompt: task === 'process' ? customPrompt : undefined,
            batchId,
            inspectId: blockOnDetection ? undefined : item.inspectId,
            blockOnDetection
          });

          setQueue(prev =>
            prev.map(q =>
              q.localId === item.localId
                ? {
                    ...q,
                    stage: 'completed',
                    statusLabel: 'Leak Check Passed · Ready to download',
                    result,
                    error: undefined
                  }
                : q
            )
          );
        } catch (err: unknown) {
          const errorObj = err as Error & { responsePayload?: { leak_check?: { passed: boolean } } };
          const isBlocked = errorObj.responsePayload?.leak_check?.passed === false ||
            errorObj.message.includes('Leak Detected');

          setQueue(prev =>
            prev.map(q =>
              q.localId === item.localId
                ? {
                    ...q,
                    stage: isBlocked ? 'blocked' : 'error',
                    statusLabel: isBlocked ? 'Leak Detected – Request Blocked' : 'Processing Failed',
                    error: errorObj.message
                  }
                : q
            )
          );
        }
      })
    );

    setIsProcessingBatch(false);
    loadAudit();
  };

  const handleDownloadOne = async (
    item: QueuedFileItem,
    formatOverride?: OutputFormat,
    variant: 'sanitized' | 'restored' = 'sanitized'
  ) => {
    const targetContent =
      variant === 'restored'
        ? item.result?.restored_response
        : item.result?.sanitized_outbound_payload || item.result?.sanitized_preview || item.result?.restored_response;
    if (!item.result || !targetContent) return;
    const fmt = formatOverride || outputFormat;
    setDownloadingId(item.localId);
    setActionError(null);
    try {
      await downloadConvertedFile({
        docId: item.result.doc_id,
        content: targetContent,
        format: fmt,
        variant,
        originalFilename: item.file.name,
        leakCheckStatus: item.result.leak_check?.status || 'Leak Check Passed',
        entitiesMasked: item.result.total_detected || 0,
        entityCounts: item.result.entity_counts || {},
        llmUsed: item.result.external_llm || 'gemini-3.8-flash'
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingId(null);
    }
  };

  const completedItems = queue.filter(
    i =>
      i.stage === 'completed' &&
      Boolean(i.result?.sanitized_outbound_payload || i.result?.sanitized_preview || i.result?.restored_response)
  );

  const handleDownloadAll = async () => {
    if (completedItems.length === 0) return;
    setDownloadingBatch(true);
    setActionError(null);
    try {
      await downloadBatchZip(
        completedItems.map(i => ({
          docId: i.result!.doc_id,
          content: i.result!.sanitized_outbound_payload || i.result!.sanitized_preview || i.result!.restored_response!,
          originalFilename: i.file.name,
          leakCheckStatus: i.result!.leak_check?.status || 'Leak Check Passed',
          entitiesMasked: i.result!.total_detected || 0,
          entityCounts: i.result!.entity_counts || {},
          llmUsed: i.result!.external_llm || 'gemini-3.8-flash'
        })),
        outputFormat,
        'sanitized'
      );
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingBatch(false);
    }
  };

  const handleClearAudit = async () => {
    try {
      await clearAuditHistory();
      setAuditLogs([]);
    } catch {
      // ignore
    }
  };

  const isInspectingAny = queue.some(i => i.stage === 'inspecting');
  const hasProcessableItems = queue.some(i => !(blockOnDetection && i.stage === 'blocked'));
  const processedCount = queue.filter(
    i => i.stage === 'completed' || i.stage === 'blocked' || i.stage === 'error'
  ).length;
  const totalCount = queue.length;
  const progressPct = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* 1. Simple Heading & Short Description */}
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3 text-xs font-medium text-[#0F2544]">
            <ShieldCheck className="w-4 h-4 text-[#EA580C]" />
            <span>DPDP Act 2023 Compliant AI Perimeter</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0F2544] [text-wrap:balance]">
            Privacy Gateway
          </h1>
          <p className="mt-2.5 text-base text-slate-600 max-w-xl mx-auto">
            Protect sensitive information before processing documents with AI.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Upload <span aria-hidden="true">·</span> Identify PII <span aria-hidden="true">·</span> Pre-Flight Leak Check <span aria-hidden="true">·</span> Process with AI <span aria-hidden="true">·</span> Restore Locally
          </p>
        </header>

        {/* 2. Main Converter Card */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
          {/* Drag-and-Drop Upload Area */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`border-2 border-dashed rounded-xl px-6 py-12 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C] ${
              dragActive
                ? 'border-[#EA580C] bg-orange-50/40'
                : 'border-slate-300 bg-slate-50/60 hover:border-[#0F2544] hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileInputChange}
              className="hidden"
            />
            <div className="mx-auto w-12 h-12 rounded-xl bg-[#0F2544] text-white flex items-center justify-center mb-4">
              <Upload className="w-5 h-5" />
            </div>
            <p className="font-display text-base font-semibold text-[#0F2544]">
              Drop documents here, or click to browse
            </p>
            <p className="mt-1.5 text-sm text-slate-500">
              Upload one or multiple files simultaneously
            </p>
            <p className="mt-3 text-xs text-slate-400">
              PDF · DOC · DOCX · PPT · PPTX · TXT · XLS · XLSX · JPG · JPEG · PNG
            </p>
          </div>

          {/* Selected File Queue & Individual Status */}
          {queue.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-[#0F2544] tabular-nums">
                  Selected Documents ({queue.length})
                </span>
                {!isProcessingBatch && (
                  <button
                    type="button"
                    onClick={clearQueue}
                    className="text-xs text-slate-500 hover:text-rose-700 transition-colors cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {queue.map(item => {
                  const maskedCategories = item.entityCounts
                    ? Object.entries(item.entityCounts)
                        .map(([k, v]) => `${k} (${v})`)
                        .join(' · ')
                    : '';

                  return (
                    <li
                      key={item.localId}
                      className="px-4 py-3 bg-white flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 text-[#0F2544] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0F2544] truncate">
                            {item.file.name}
                          </p>
                          <p className="text-xs text-slate-500 font-mono tabular-nums">
                            {formatFileSize(item.file.size)}
                            <span aria-hidden="true"> · </span>
                            <span
                              className={
                                item.stage === 'completed' || item.stage === 'masked'
                                  ? 'text-emerald-700 font-sans font-medium'
                                  : item.stage === 'blocked' || item.stage === 'error'
                                  ? 'text-rose-700 font-sans font-medium'
                                  : item.stage === 'processing' || item.stage === 'inspecting'
                                  ? 'text-[#EA580C] font-sans font-medium'
                                  : 'text-slate-500 font-sans'
                              }
                            >
                              {item.statusLabel}
                            </span>
                            {item.stage === 'masked' && (item.totalDetected || 0) > 0 && maskedCategories && (
                              <span className="text-slate-400 font-mono">
                                {` · ${item.totalDetected} masked (${maskedCategories})`}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(item.stage === 'processing' || item.stage === 'inspecting') && (
                          <Loader2 className="w-4 h-4 text-[#EA580C] animate-spin" />
                        )}
                        {(item.stage === 'completed' || item.stage === 'masked') && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        )}
                        {(item.stage === 'blocked' || item.stage === 'error') && (
                          <AlertCircle className="w-4 h-4 text-rose-700" />
                        )}
                        {item.stage !== 'processing' && item.stage !== 'inspecting' && (
                          <button
                            type="button"
                            onClick={() => removeQueueItem(item.localId)}
                            aria-label={`Remove ${item.file.name}`}
                            className="p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Output Format & Primary Action Row */}
          <div className="mt-6 pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              {/* Output Format Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Output Format
                </label>
                <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200">
                  {OUTPUT_FORMATS.map(fmt => (
                    <button
                      key={fmt.value}
                      type="button"
                      onClick={() => setOutputFormat(fmt.value)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        outputFormat === fmt.value
                          ? 'bg-[#0F2544] text-white'
                          : 'text-slate-600 hover:text-[#0F2544]'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Task Selector */}
              <div className="min-w-[180px]">
                <label htmlFor="task-select" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Processing Goal
                </label>
                <select
                  id="task-select"
                  value={task}
                  onChange={e => setTask(e.target.value as TaskType)}
                  className="w-full px-3 py-2 text-xs font-medium text-[#0F2544] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EA580C]"
                >
                  {TASK_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Single Primary Button */}
            <button
              type="button"
              onClick={handleIdentifyAndProcess}
              disabled={queue.length === 0 || isProcessingBatch || isInspectingAny || !hasProcessableItems}
              className={`px-6 py-3 rounded-xl font-display text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                queue.length === 0 || isProcessingBatch || isInspectingAny || !hasProcessableItems
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-[#0F2544] hover:bg-[#173561] text-white'
              }`}
            >
              {isProcessingBatch ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#EA580C]" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#EA580C]" />
                  <span>Identify & Process</span>
                </>
              )}
            </button>
          </div>

          {/* Optional Strict Policy Override Toggle */}
          <div className="mt-4 flex items-center justify-between gap-4 text-xs text-slate-600">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={blockOnDetection}
                onChange={e => setBlockOnDetection(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-[#0F2544] focus:ring-[#EA580C]"
              />
              <span>Block on Detection (Strict — halt upload if any PII is found instead of masking)</span>
            </label>
          </div>

          {/* Optional Custom Prompt Input (only shown if Custom Prompt is chosen) */}
          {task === 'process' && (
            <div className="mt-4">
              <input
                type="text"
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="Enter your question or processing instruction (e.g., Extract loan amount, EMI, and compliance deadlines)..."
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#EA580C]"
              />
            </div>
          )}

          {/* Simple Processing Status Indicator */}
          {isProcessingBatch && (
            <div className="mt-6 pt-5 border-t border-slate-200">
              <div className="flex items-center justify-between text-xs font-medium text-[#0F2544] mb-2 tabular-nums">
                <span>
                  Processing documents securely ({processedCount} of {totalCount} complete)
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#EA580C] transition-all duration-300"
                  style={{ width: `${Math.max(10, progressPct)}%` }}
                />
              </div>
            </div>
          )}

          {actionError && (
            <div className="mt-5 p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}
        </section>

        {/* 3. Final Download & Verification Section */}
        {queue.some(i => i.stage === 'completed' || i.stage === 'blocked' || i.stage === 'error') && (
          <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0F2544]">
                  Processed Results & Download
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Downloaded files contain the Sanitized Outbound Payload with safe placeholders (zero raw PII).
                </p>
              </div>

              {completedItems.length > 1 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloadingBatch}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4C06] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {downloadingBatch ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Archive className="w-3.5 h-3.5" />
                  )}
                  <span>Download All ({outputFormat.toUpperCase()} ZIP)</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-200">
              {queue
                .filter(i => i.stage === 'completed' || i.stage === 'blocked' || i.stage === 'error')
                .map(item => {
                  const res = item.result;
                  const isExpanded = expandedDocId === item.localId;
                  const categoriesText = res?.entity_counts
                    ? Object.entries(res.entity_counts)
                        .map(([k, v]) => `${k} (${v})`)
                        .join(' · ')
                    : '';

                  return (
                    <div key={item.localId} className="py-5 first:pt-4 last:pb-0">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-semibold text-sm text-[#0F2544] truncate max-w-md">
                              {item.file.name}
                            </span>

                            {item.stage === 'completed' && res?.leak_check && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                <ShieldCheck className="w-4 h-4 shrink-0" />
                                <span>{res.leak_check.status}</span>
                              </span>
                            )}

                            {item.stage === 'blocked' && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                                <ShieldAlert className="w-4 h-4 shrink-0" />
                                <span>Leak Detected – Request Blocked</span>
                              </span>
                            )}

                            {item.stage === 'error' && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span>Processing Error</span>
                              </span>
                            )}
                          </div>

                          {item.stage === 'completed' && res ? (
                            <p className="text-xs text-slate-500 font-mono tabular-nums">
                              {res.total_detected || 0} PII masked
                              {categoriesText ? ` · ${categoriesText}` : ''}
                              {res.ocr_used ? ' · OCR applied' : ''}
                              {res.latency_ms ? ` · ${res.latency_ms} ms` : ''}
                            </p>
                          ) : (
                            <p className="text-xs text-rose-700">
                              {item.error}
                            </p>
                          )}
                        </div>

                        {item.stage === 'completed' && res && (
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setExpandedDocId(isExpanded ? null : item.localId)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              <span>{isExpanded ? 'Hide Details' : 'Inspect'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDownloadOne(item)}
                              disabled={downloadingId === item.localId}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0F2544] hover:bg-[#173561] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {downloadingId === item.localId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5 text-[#EA580C]" />
                              )}
                              <span>Download {outputFormat.toUpperCase()}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Expandable Inspection Drawer (Restored Result vs Sanitized Outbound Payload) */}
                      {isExpanded && res && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                            <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200">
                              <button
                                type="button"
                                onClick={() => setPreviewTab('restored')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                  previewTab === 'restored'
                                    ? 'bg-white text-[#0F2544] shadow-xs'
                                    : 'text-slate-600 hover:text-[#0F2544]'
                                }`}
                              >
                                Restored Final Output
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewTab('sanitized')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                  previewTab === 'sanitized'
                                    ? 'bg-white text-[#0F2544] shadow-xs'
                                    : 'text-slate-600 hover:text-[#0F2544]'
                                }`}
                              >
                                Sanitized Outbound Payload (Sent to AI)
                              </button>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <span>Also export as:</span>
                              {OUTPUT_FORMATS.filter(f => f.value !== outputFormat).map(f => (
                                <button
                                  key={f.value}
                                  type="button"
                                  onClick={() => handleDownloadOne(item, f.value, 'sanitized')}
                                  className="px-2 py-1 rounded border border-slate-200 hover:border-[#0F2544] text-[#0F2544] font-medium transition-colors cursor-pointer"
                                >
                                  {f.label}
                                </button>
                              ))}
                              {previewTab === 'restored' && (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadOne(item, outputFormat, 'restored')}
                                  className="ml-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 hover:border-emerald-500 text-emerald-800 font-medium transition-colors cursor-pointer"
                                >
                                  Download Restored {outputFormat.toUpperCase()}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-80 overflow-y-auto">
                            <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                              {previewTab === 'restored'
                                ? res.restored_response
                                : res.sanitized_outbound_payload}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* 4. Inline Collapsible Audit History */}
        <AuditHistorySection
          logs={auditLogs}
          loading={auditLoading}
          onRefresh={loadAudit}
          onClear={handleClearAudit}
        />
      </main>
    </div>
  );
}
