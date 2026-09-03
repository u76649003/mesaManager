// ============================================================
// MesaManager — Local AI Provider (llama.cpp via Capacitor)
// ============================================================
// Implements AIProvider using the native LocalAI Capacitor plugin.
// Falls back gracefully when the model is not installed or JNI is unavailable.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { AIProvider, AIProviderResponse, AIMessage, AITool } from './types';

// ── Capacitor plugin interface ──────────────────────────────────────────────

interface LocalAIDeviceCapabilities {
  ramMb: number;
  totalRamMb: number;
  freeStorageMb: number;
  architecture: string;
  androidSdk: number;
  nativeLibsAvailable: boolean;
  recommendedContext: number;
}

interface LocalAIModelStatus {
  installed: boolean;
  path?: string;
  sizeMb?: number;
  model?: string;
}

interface LocalAIChatResponse {
  available: boolean;
  content?: string;
  finish_reason?: string;
  tool_calls_json?: string; // JSON string of OpenAI-compatible tool_calls array
  error?: string;
}

interface LocalAIDownloadProgress {
  downloaded: number;
  total: number;
  progress: number;
  complete?: boolean;
  path?: string;
  error?: string;
}

interface LocalAIPluginInterface {
  isSupported(): Promise<{ supported: boolean }>;
  getDeviceCapabilities(): Promise<LocalAIDeviceCapabilities>;
  isModelInstalled(options?: { filename?: string }): Promise<LocalAIModelStatus>;
  loadModel(options?: { path?: string; filename?: string }): Promise<{ loaded: boolean; error?: string }>;
  chat(options: { messages: unknown[]; tools?: unknown[] }): Promise<LocalAIChatResponse>;
  cancel(): Promise<void>;
  unloadModel(): Promise<void>;
  downloadModel(options?: { url?: string; filename?: string }): Promise<void>;
  deleteModel(options?: { filename?: string }): Promise<{ deleted: boolean }>;
  addListener(
    event: 'downloadProgress',
    listener: (data: LocalAIDownloadProgress) => void
  ): Promise<PluginListenerHandle>;
}

// Register the Capacitor plugin
const LocalAI = registerPlugin<LocalAIPluginInterface>('LocalAI');

// ── LocalLlamaProvider ──────────────────────────────────────────────────────

export class LocalLlamaProvider implements AIProvider {
  private _available = false;
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  /** Check and cache availability. Call before first use. */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    await this._initPromise;
  }

  private async _doInit(): Promise<void> {
    // Only works on native Android
    if (!Capacitor.isNativePlatform()) {
      console.info('[LocalAI] Not a native platform — LocalAI disabled');
      this._available = false;
      this._initialized = true;
      return;
    }

    try {
      const supported = await LocalAI.isSupported();
      if (!supported.supported) {
        console.info('[LocalAI] JNI not available on this device');
        this._available = false;
        this._initialized = true;
        return;
      }

      const status = await LocalAI.isModelInstalled();
      if (!status.installed) {
        console.info('[LocalAI] Model not installed — LocalAI unavailable until model is downloaded');
        this._available = false;
        this._initialized = true;
        return;
      }

      // Check RAM — need at least 800 MB free for Qwen2.5-0.5B Q4_K_M
      const caps = await LocalAI.getDeviceCapabilities();
      if (caps.ramMb > 0 && caps.ramMb < 500) {
        console.warn('[LocalAI] Insufficient RAM (' + caps.ramMb + ' MB free) — LocalAI disabled');
        this._available = false;
        this._initialized = true;
        return;
      }

      // Load model (non-blocking first time — succeeds if already loaded)
      const loaded = await LocalAI.loadModel({ path: status.path });
      if (!loaded.loaded) {
        console.warn('[LocalAI] Model load failed:', loaded.error);
        this._available = false;
        this._initialized = true;
        return;
      }

      console.info('[LocalAI] Initialized and ready. Model:', status.model, status.sizeMb + ' MB');
      this._available = true;
    } catch (err) {
      console.warn('[LocalAI] Init error:', err);
      this._available = false;
    }
    this._initialized = true;
  }

  get available(): boolean {
    return this._available;
  }

  /** Force re-check (e.g., after model download completes). */
  async refresh(): Promise<void> {
    this._initialized = false;
    this._initPromise = null;
    this._available = false;
    await this.initialize();
  }

  async chat(
    messages: AIMessage[],
    tools: AITool[],
    signal?: AbortSignal
  ): Promise<AIProviderResponse> {
    if (!this._available) {
      return { content: null, finish_reason: 'error' };
    }

    // Handle abort
    const abortListener = signal
      ? () => { void LocalAI.cancel(); }
      : null;
    if (abortListener && signal) signal.addEventListener('abort', abortListener);

    try {
      // 5 second timeout for local inference
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        void LocalAI.cancel();
        timeoutController.abort();
      }, 25_000); // 25s — local inference can be slower

      const response = await LocalAI.chat({
        messages: messages as unknown[],
        tools: tools.length > 0 ? (tools as unknown[]) : undefined,
      });

      clearTimeout(timeoutId);

      if (!response.available) {
        console.warn('[LocalAI] chat returned unavailable:', response.error);
        this._available = false; // Mark as unavailable for this session
        return { content: null, finish_reason: 'error' };
      }

      // Parse tool_calls if present
      if (response.finish_reason === 'tool_calls' && response.tool_calls_json) {
        try {
          const toolCalls = JSON.parse(response.tool_calls_json) as Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
          return {
            content: response.content ?? null,
            tool_calls: toolCalls,
            finish_reason: 'tool_calls',
          };
        } catch (e) {
          console.warn('[LocalAI] Failed to parse tool_calls_json:', e);
        }
      }

      return {
        content: response.content ?? null,
        finish_reason: (response.finish_reason as AIProviderResponse['finish_reason']) ?? 'stop',
      };
    } catch (err) {
      console.warn('[LocalAI] chat error:', err);
      return { content: null, finish_reason: 'error' };
    } finally {
      if (abortListener && signal) signal.removeEventListener('abort', abortListener);
    }
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────
export const localLlamaProvider = new LocalLlamaProvider();

// ── Re-export plugin for model management ───────────────────────────────────
export { LocalAI };
export type {
  LocalAIDeviceCapabilities,
  LocalAIModelStatus,
  LocalAIDownloadProgress,
  LocalAIPluginInterface,
};
