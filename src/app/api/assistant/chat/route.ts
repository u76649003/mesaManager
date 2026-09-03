'use server';
// ============================================================
// MesaManager — /api/assistant/chat
// ============================================================
// Server-side proxy to Ollama.
// Protects OLLAMA_URL from being exposed to the client.
// Handles: timeout, concurrency, error normalization, validation.

import { type NextRequest, NextResponse } from 'next/server';
import type { AIMessage, AITool, AIToolCall } from '@/lib/assistant/ai/types';
import { createClient } from '@/lib/supabase/server';

// ── Config ────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 3000);

// ── Active request map (simple concurrency guard per session) ─
// In production with multiple replicas, use Redis. For single-server use, a Map suffices.
const pendingRequests = new Map<string, AbortController>();

interface ChatRequest {
  messages: AIMessage[];
  tools: AITool[];
  restaurantContext: string;
  sessionId?: string;
}

interface OllamaResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done?: boolean;
  done_reason?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Authenticate and resolve tenant's custom Gemini API Key ──────────────
  let customGeminiKey: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      if (profile?.tenant_id) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('gemini_api_key')
          .eq('id', profile.tenant_id)
          .single();
        if (tenant?.gemini_api_key) {
          customGeminiKey = tenant.gemini_api_key;
        }
      }
    }
  } catch (err) {
    console.warn('[AI-API] Failed to retrieve tenant Gemini key from database:', err);
  }

  const activeGeminiKey = customGeminiKey || process.env.GEMINI_API_KEY;

  // If running on Vercel serverless and OLLAMA_URL is localhost, and GEMINI_API_KEY/activeGeminiKey is not set,
  // Ollama is guaranteed offline. Return available: false immediately.
  const isVercel = Boolean(process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_ENV);
  const isLocalhost = OLLAMA_URL.includes('localhost') || OLLAMA_URL.includes('127.0.0.1');
  if (isVercel && isLocalhost && !activeGeminiKey) {
    return NextResponse.json({ available: false, error: 'Ollama is running locally, not on Vercel' });
  }

  let body: ChatRequest;
  try {
    body = await req.json() as ChatRequest;
  } catch {
    return NextResponse.json({ available: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { messages, tools, sessionId } = body;

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ available: false, error: 'messages required' }, { status: 400 });
  }

  // ── Abort any in-flight request for this session ─────────
  const sid = sessionId ?? 'default';
  pendingRequests.get(sid)?.abort();
  const controller = new AbortController();
  pendingRequests.set(sid, controller);

  // ── Timeout ───────────────────────────────────────────────
  const timeoutMs = activeGeminiKey ? 8000 : TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (activeGeminiKey) {
      const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      console.info(`[AI-API] → Gemini ${geminiModel} (${messages.length} messages)`);

      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeGeminiKey}`,
        },
        body: JSON.stringify({
          model: geminiModel,
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[AI-API] Gemini returned ${response.status}: ${errorText}`);
        return NextResponse.json({ available: false, error: `Gemini HTTP ${response.status}` });
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;

      if (!message) {
        return NextResponse.json({ available: false, error: 'Empty response from Gemini' });
      }

      // Normalise tool_calls
      const toolCalls: AIToolCall[] | undefined = message.tool_calls?.map((tc: any, i: number) => ({
        id: tc.id || `call_${i}_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
        },
      }));

      const finishReason = toolCalls?.length ? 'tool_calls' : (data.choices?.[0]?.finish_reason || 'stop');

      console.info(`[AI-API] ← Gemini finish_reason=${finishReason} tool_calls=${toolCalls?.length ?? 0}`);

      return NextResponse.json({
        available: true,
        content: message.content ?? null,
        tool_calls: toolCalls,
        finish_reason: finishReason,
      });
    } else {
      console.info(`[AI-API] → Ollama ${OLLAMA_MODEL} (${messages.length} messages)`);

      const ollamaBody = {
        model: OLLAMA_MODEL,
        messages,
        tools: tools ?? [],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 512,
        },
      };

      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn(`[AI-API] Ollama returned ${response.status}`);
        return NextResponse.json({ available: false, error: `Ollama HTTP ${response.status}` });
      }

      const data: OllamaResponse = await response.json() as OllamaResponse;
      const message = data.message;

      if (!message) {
        return NextResponse.json({ available: false, error: 'Empty response from Ollama' });
      }

      // ── Normalise tool_calls ─────────────────────────────────
      const toolCalls: AIToolCall[] | undefined = message.tool_calls?.map((tc, i) => ({
        id: `call_${i}_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
        },
      }));

      const finishReason = toolCalls?.length ? 'tool_calls' : (data.done_reason === 'stop' ? 'stop' : 'stop');

      console.info(`[AI-API] ← finish_reason=${finishReason} tool_calls=${toolCalls?.length ?? 0}`);

      return NextResponse.json({
        available: true,
        content: message.content ?? null,
        tool_calls: toolCalls,
        finish_reason: finishReason,
      });
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.info('[AI-API] Request aborted (timeout or new request)');
      return NextResponse.json({ available: false, error: 'timeout' });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[AI-API] AI service unavailable:', message);
    return NextResponse.json({ available: false, error: message });
  } finally {
    clearTimeout(timeout);
    // Clean up only if this is still the active controller
    if (pendingRequests.get(sid) === controller) {
      pendingRequests.delete(sid);
    }
  }
}
