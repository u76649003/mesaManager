// ============================================================
// MesaManager — Ollama AI Client
// ============================================================
// Calls the server-side /api/assistant/chat route.
// NEVER calls Ollama directly from the frontend.

import type { AIMessage, AITool, AIProviderResponse } from './types';

export interface OllamaChatRequest {
  messages: AIMessage[];
  tools: AITool[];
  restaurantContext: string;
}

export interface OllamaChatResponse {
  available: boolean;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  finish_reason?: string;
  error?: string;
}

/**
 * Call the MesaManager assistant chat endpoint.
 * Returns null if the AI is unavailable (caller falls back to parseAssistantIntent).
 */
export async function callAssistantChat(
  req: OllamaChatRequest,
  signal?: AbortSignal
): Promise<AIProviderResponse | null> {
  try {
    // Client-side 3.5s timeout signal so UI never hangs waiting for AI
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 3500);

    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    const response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: combinedSignal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[AI] /api/assistant/chat returned', response.status);
      return null;
    }

    const data: OllamaChatResponse = await response.json();

    if (!data.available) {
      console.info('[AI] Ollama not available — using fallback');
      return null;
    }

    return {
      content: data.content ?? null,
      tool_calls: data.tool_calls,
      finish_reason: (data.finish_reason as AIProviderResponse['finish_reason']) ?? 'stop',
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.info('[AI] Request aborted');
      return null;
    }
    console.warn('[AI] callAssistantChat error:', err);
    return null;
  }
}
