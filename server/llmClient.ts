/**
 * Pluggable External LLM & Local SLM Fallback Client
 *
 * - Primary External LLM: Google Gemini (`gemini-3.8-flash`) via @google/genai
 * - Local SLM Ready Slot: Configurable `LOCAL_SLM_URL` (e.g. Ollama / OpenAI-compatible local server)
 * - Strictly transmits ONLY the sanitized outbound payload (verified by Leak Check).
 * - Never fabricates fake success responses when the LLM is unavailable.
 */

import { GoogleGenAI } from '@google/genai';

export interface LLMRequestOptions {
  sanitizedText: string;
  task: string;
  customPrompt?: string;
  provider?: 'gemini' | 'local-slm';
}

export interface LLMResponsePayload {
  rawAiResponse: string;
  outboundPrompt: string;
  modelUsed: string;
}

const TASK_INSTRUCTIONS: Record<string, string> = {
  summarize:
    'Provide a clear, structured executive summary of this document. Preserve headings, key figures, dates, and tables where applicable.',
  extract:
    'Extract all key structured fields, entities, monetary amounts, dates, and action items from this document using clean Markdown headings and tables.',
  audit:
    'Perform a regulatory compliance and risk assessment under India\'s Digital Personal Data Protection (DPDP) Act 2023. Highlight obligations, risks, and action items.',
  process:
    'Analyze and rewrite this document into a clean, well-structured professional brief preserving all important sections, tables, and details.'
};

export function buildOutboundPrompt(sanitizedText: string, task: string, customPrompt?: string): string {
  const instruction = customPrompt?.trim()
    ? customPrompt.trim()
    : TASK_INSTRUCTIONS[task] || TASK_INSTRUCTIONS.summarize;

  return `You are an enterprise document processing assistant operating behind a DPDP Privacy Gateway.
All sensitive personal data in the document below has been replaced with SafeHolder placeholders (such as <SAFEHOLDER_PERSON_1>, <SAFEHOLDER_ADDRESS_1>, <SAFEHOLDER_AADHAAR_1>, <SAFEHOLDER_PAN_1>, <SAFEHOLDER_BANK_ACC_1>, <SAFEHOLDER_GSTIN_1>, <SAFEHOLDER_PHONE_1>, <SAFEHOLDER_EMAIL_1>, <SAFEHOLDER_IFSC_1>).

Sanitized Document Content:
---
${sanitizedText}
---

Instruction:
${instruction}

Critical Formatting Rules:
1. Preserve every SafeHolder placeholder token EXACTLY as written (e.g., <SAFEHOLDER_PERSON_1>, <SAFEHOLDER_ADDRESS_1>, <SAFEHOLDER_AADHAAR_1>, <SAFEHOLDER_PAN_1>, <SAFEHOLDER_BANK_ACC_1>) wherever you refer to that entity, so the local gateway can restore the original values safely.
2. Never invent, guess, or alter placeholder numbers or bracket syntax.
3. Structure your output clearly with Markdown headings (##), bullet points (-), and Markdown tables (| Col |) when summarizing tabular data.`;
}

export async function invokePluggableLLM(options: LLMRequestOptions): Promise<LLMResponsePayload> {
  const outboundPrompt = buildOutboundPrompt(options.sanitizedText, options.task, options.customPrompt);
  const preferredProvider = options.provider || 'gemini';

  // Local SLM Fallback / Pluggable Slot (OpenAI-compatible or Ollama endpoint)
  if (preferredProvider === 'local-slm') {
    const slmUrl = process.env.LOCAL_SLM_URL;
    if (!slmUrl) {
      throw new Error(
        'Local SLM provider selected, but LOCAL_SLM_URL is not configured on the server.'
      );
    }
    const resp = await fetch(slmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LOCAL_SLM_MODEL || 'llama3.2:3b',
        prompt: outboundPrompt,
        stream: false
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) {
      throw new Error(`Local SLM endpoint returned HTTP ${resp.status}.`);
    }
    const data = await resp.json() as { response?: string; choices?: Array<{ message?: { content?: string } }> };
    const text = data.response || data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('Local SLM returned an empty response.');
    }
    return {
      rawAiResponse: text,
      outboundPrompt,
      modelUsed: process.env.LOCAL_SLM_MODEL || 'local-slm'
    };
  }

  // Primary External LLM: Google Gemini via @google/genai
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    // Check if Local SLM fallback is explicitly configured
    if (process.env.LOCAL_SLM_URL) {
      return await invokePluggableLLM({ ...options, provider: 'local-slm' });
    }
    throw new Error(
      'External LLM unavailable: GEMINI_API_KEY is not configured in the server environment.'
    );
  }

  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-flash-latest', 'gemini-3.1-flash-lite'])
  );

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  let lastErrorMsg = '';
  for (const modelName of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const generatePromise = ai.models.generateContent({
          model: modelName,
          contents: outboundPrompt
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API request timed out after 30s')), 30000)
        );
        const response = await Promise.race([generatePromise, timeoutPromise]);
        const text = response.text?.trim();
        if (!text) {
          throw new Error('Gemini API returned an empty text response.');
        }
        return {
          rawAiResponse: text,
          outboundPrompt,
          modelUsed: modelName
        };
      } catch (err: unknown) {
        lastErrorMsg = err instanceof Error ? err.message : String(err);
        const isTransient =
          lastErrorMsg.includes('503') ||
          lastErrorMsg.includes('UNAVAILABLE') ||
          lastErrorMsg.includes('429') ||
          lastErrorMsg.includes('timed out');
        if (!isTransient) {
          break;
        }
        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      }
    }
  }

  // If local SLM fallback URL is configured, try fallback automatically
  if (process.env.LOCAL_SLM_URL) {
    try {
      return await invokePluggableLLM({ ...options, provider: 'local-slm' });
    } catch {
      // fall through to primary error
    }
  }

  throw new Error(`External LLM processing failed (${primaryModel}): ${lastErrorMsg}`);
}
