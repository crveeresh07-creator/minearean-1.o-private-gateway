import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ShieldAlert,
  RefreshCw,
  Trash2,
  Eye,
  EyeOff
} from 'lucide-react';
import { AuditRecord } from '../types';

interface AuditHistorySectionProps {
  logs: AuditRecord[];
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
}

export const AuditHistorySection: React.FC<AuditHistorySectionProps> = ({
  logs,
  loading,
  onRefresh,
  onClear
}) => {
  const [expanded, setExpanded] = useState(false);
  const [openPayloadId, setOpenPayloadId] = useState<number | null>(null);

  return (
    <section className="mt-10 border-t border-slate-200 pt-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#0F2544] hover:text-[#EA580C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span>Audit History</span>
          <span className="text-xs font-mono font-normal text-slate-500 tabular-nums">
            ({logs.length})
          </span>
        </button>

        {expanded && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F2544] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 hover:text-rose-800 px-2.5 py-1.5 rounded-md border border-rose-200 bg-white hover:bg-rose-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
            Zero raw PII is persisted in audit records. Only anonymized entity counts, leak check results, and the sanitized outbound payload are stored.
          </div>

          {logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              No documents processed yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-[#0F2544] text-white">
                  <tr>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Date & Time</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Document</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Detected PII</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Masking</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Leak Check</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">External LLM</th>
                    <th className="py-2.5 px-4 font-medium whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {logs.map(log => {
                    const isPassed = log.leak_check_status === 'Leak Check Passed';
                    const isBlocked = log.leak_check_status.includes('Blocked');
                    const isOpen = openPayloadId === log.id;
                    const categorySummary = Object.entries(log.entity_counts || {})
                      .map(([k, v]) => `${k} (${v})`)
                      .join(' · ');

                    return (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap tabular-nums">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 font-medium text-[#0F2544] max-w-[200px] truncate" title={log.document_name}>
                            {log.document_name}
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-mono text-[11px]">
                            {log.total_entities > 0 ? (
                              <span title={categorySummary}>
                                {log.total_entities} total — {categorySummary}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                            {log.masking_status}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 font-medium ${
                                isPassed
                                  ? 'text-emerald-700'
                                  : isBlocked
                                  ? 'text-rose-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {isPassed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : isBlocked ? (
                                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                              ) : null}
                              <span>{log.leak_check_status}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {log.external_llm}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                            {log.processing_status}
                            <span className="text-slate-400 font-mono ml-1.5">
                              {log.latency_ms}ms
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {log.sanitized_payload ? (
                              <button
                                type="button"
                                onClick={() => setOpenPayloadId(isOpen ? null : log.id)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#0F2544] hover:text-[#EA580C] transition-colors"
                              >
                                {isOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                <span>{isOpen ? 'Hide' : 'Inspect'}</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50">
                            <td colSpan={8} className="p-4">
                              <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                                Exact Sanitized Outbound Payload Sent to {log.external_llm}
                              </div>
                              <pre className="p-3 bg-white border border-slate-200 rounded-lg font-mono text-[11px] text-slate-800 whitespace-pre-wrap max-h-60 overflow-y-auto">
                                {log.sanitized_payload}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
