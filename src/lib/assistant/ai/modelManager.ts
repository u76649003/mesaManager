// ============================================================
// MesaManager — Model Manager
// ============================================================
// Manages the lifecycle of the local GGUF model:
// download, validation, load, status reporting.

import { Capacitor } from '@capacitor/core';
import { LocalAI, localLlamaProvider } from './localProvider';
import type { LocalAIModelStatus, LocalAIDownloadProgress, LocalAIDeviceCapabilities } from './localProvider';

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL_FILENAME = 'qwen2.5-0.5b-instruct-q4_k_m.gguf';
export const DEFAULT_MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
export const DEFAULT_MODEL_SIZE_MB = 397;

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelState =
  | 'unavailable'    // Device doesn't support local AI (no JNI / not Android)
  | 'not_installed'  // Supported but model not downloaded
  | 'downloading'    // Download in progress
  | 'loading'        // Model installed, loading into memory
  | 'ready'          // Ready for inference
  | 'error';         // Error state

export interface ModelInfo {
  state: ModelState;
  filename: string;
  sizeMb?: number;
  downloadProgress?: number; // 0-100
  error?: string;
  capabilities?: LocalAIDeviceCapabilities;
}

// ── Model Manager ────────────────────────────────────────────────────────────

class ModelManager {
  private listeners: Array<(info: ModelInfo) => void> = [];
  private currentInfo: ModelInfo = { state: 'unavailable', filename: DEFAULT_MODEL_FILENAME };
  private downloadHandle: ReturnType<typeof LocalAI.addListener> | null = null;

  /** Subscribe to model state changes. Returns unsubscribe function. */
  subscribe(listener: (info: ModelInfo) => void): () => void {
    this.listeners.push(listener);
    // Immediately notify with current state
    listener(this.currentInfo);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(info: Partial<ModelInfo>) {
    this.currentInfo = { ...this.currentInfo, ...info };
    this.listeners.forEach((l) => l(this.currentInfo));
  }

  /** Check current status of the model. */
  async checkStatus(): Promise<ModelInfo> {
    if (!Capacitor.isNativePlatform()) {
      this.emit({ state: 'unavailable' });
      return this.currentInfo;
    }

    try {
      const supported = await LocalAI.isSupported();
      if (!supported.supported) {
        this.emit({ state: 'unavailable', error: 'IA local no disponible en este dispositivo.' });
        return this.currentInfo;
      }

      const caps = await LocalAI.getDeviceCapabilities();
      const status: LocalAIModelStatus = await LocalAI.isModelInstalled();

      if (!status.installed) {
        this.emit({ state: 'not_installed', capabilities: caps });
        return this.currentInfo;
      }

      if (!localLlamaProvider.available && this.currentInfo.state !== 'loading') {
        this.emit({ state: 'loading', sizeMb: status.sizeMb, capabilities: caps });
        void this.loadModel();
        return this.currentInfo;
      }

      this.emit({
        state: 'ready',
        sizeMb: status.sizeMb,
        capabilities: caps,
      });
    } catch (err) {
      this.emit({ state: 'error', error: String(err) });
    }
    return this.currentInfo;
  }

  /** Start model download. Emits progress events. */
  async downloadModel(
    url = DEFAULT_MODEL_URL,
    filename = DEFAULT_MODEL_FILENAME
  ): Promise<void> {
    if (this.currentInfo.state === 'downloading') return;
    this.emit({ state: 'downloading', downloadProgress: 0 });

    // Set up progress listener
    const handle = await LocalAI.addListener('downloadProgress', (data: LocalAIDownloadProgress) => {
      if (data.error) {
        this.emit({ state: 'error', error: data.error, downloadProgress: undefined });
        this.cleanupDownloadListener();
        return;
      }
      if (data.complete) {
        this.emit({ state: 'loading', downloadProgress: 100 });
        this.cleanupDownloadListener();
        // Auto-load after download
        void this.loadModel();
        return;
      }
      this.emit({ downloadProgress: data.progress });
    });
    this.downloadHandle = Promise.resolve(handle);

    try {
      await LocalAI.downloadModel({ url, filename });
    } catch (err) {
      this.emit({ state: 'error', error: String(err) });
      this.cleanupDownloadListener();
    }
  }

  /** Load the model into memory. */
  async loadModel(filename = DEFAULT_MODEL_FILENAME): Promise<boolean> {
    this.emit({ state: 'loading' });
    try {
      await localLlamaProvider.refresh();
      if (localLlamaProvider.available) {
        this.emit({ state: 'ready' });
        return true;
      } else {
        const status = await LocalAI.isModelInstalled({ filename });
        if (!status.installed) {
          this.emit({ state: 'not_installed' });
        } else {
          this.emit({ state: 'error', error: 'No se pudo cargar el modelo.' });
        }
        return false;
      }
    } catch (err) {
      this.emit({ state: 'error', error: String(err) });
      return false;
    }
  }

  /** Delete the model from device storage. */
  async deleteModel(filename = DEFAULT_MODEL_FILENAME): Promise<boolean> {
    try {
      await LocalAI.unloadModel();
      const result = await LocalAI.deleteModel({ filename });
      await localLlamaProvider.refresh(); // refresh availability
      this.emit({ state: 'not_installed', downloadProgress: undefined });
      return result.deleted;
    } catch (err) {
      this.emit({ state: 'error', error: String(err) });
      return false;
    }
  }

  private async cleanupDownloadListener() {
    if (this.downloadHandle) {
      try {
        const handle = await this.downloadHandle;
        await handle.remove();
      } catch { /* ignore */ }
      this.downloadHandle = null;
    }
  }

  get info(): ModelInfo { return this.currentInfo; }
}

/** Singleton model manager — import and use across the app. */
export const modelManager = new ModelManager();
