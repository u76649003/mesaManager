package com.mesamanager.app;

import android.app.ActivityManager;
import android.content.Context;
import android.os.StatFs;
import android.util.Log;
import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LocalAIEngine — wraps llama.cpp JNI for MesaManager.
 *
 * The native library (libmesaai.so) is compiled from llama.cpp via CMake/NDK.
 * See android/app/src/main/cpp/CMakeLists.txt for build configuration.
 *
 * Model lifecycle: loadModel() → chat() × N → unloadModel()
 * All inference runs on the caller's thread (LocalAIPlugin uses background executor).
 */
public class LocalAIEngine {

    private static final String TAG = "LocalAIEngine";

    // Singleton
    private static volatile LocalAIEngine instance;

    // State
    private volatile long contextHandle = 0;        // pointer to llama_context
    private volatile long modelHandle   = 0;        // pointer to llama_model
    private volatile boolean modelLoaded = false;
    private volatile String loadedModelPath = null;
    private final AtomicBoolean cancelFlag = new AtomicBoolean(false);
    private final Object lock = new Object();

    // Default inference parameters (mobile-optimized)
    public static final int  DEFAULT_N_CTX        = 2048;
    public static final int  DEFAULT_N_THREADS     = 4;
    public static final int  DEFAULT_MAX_TOKENS    = 300;
    public static final float DEFAULT_TEMPERATURE  = 0.1f;
    public static final int  DEFAULT_N_GPU_LAYERS  = 0;  // CPU only

    // Native library availability
    private static volatile boolean nativeLibLoaded = false;
    private static volatile boolean nativeLibChecked = false;
    private static volatile String  nativeLibError   = null;

    private LocalAIEngine() {}

    public static LocalAIEngine getInstance() {
        if (instance == null) {
            synchronized (LocalAIEngine.class) {
                if (instance == null) instance = new LocalAIEngine();
            }
        }
        return instance;
    }

    /** Call once at app startup to load the native library. */
    public synchronized void init() {
        if (nativeLibChecked) return;
        nativeLibChecked = true;
        try {
            System.loadLibrary("mesaai");  // libmesaai.so — our JNI bridge
            nativeLibLoaded = true;
            Log.i(TAG, "libmesaai.so loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            nativeLibLoaded = false;
            nativeLibError = e.getMessage();
            Log.w(TAG, "libmesaai.so NOT available — LocalAI disabled. " + e.getMessage());
        }
    }

    // ── Public API ──────────────────────────────────────────────────────────

    public boolean isNativeAvailable() { return nativeLibLoaded; }
    public String  getNativeError()    { return nativeLibError; }
    public boolean isModelLoaded()     { return modelLoaded; }
    public String  getLoadedModelPath(){ return loadedModelPath; }

    /**
     * Load a GGUF model into memory. Blocking — call from background thread.
     * @return true on success
     */
    public boolean loadModel(String path) {
        if (!nativeLibLoaded) return false;
        synchronized (lock) {
            if (modelLoaded && path.equals(loadedModelPath)) {
                Log.d(TAG, "Model already loaded: " + path);
                return true;
            }
            if (modelLoaded) doUnload();

            File f = new File(path);
            if (!f.exists() || f.length() < 1024 * 1024) {
                Log.e(TAG, "Model file missing or too small: " + path);
                return false;
            }

            Log.i(TAG, "Loading model: " + path + " (" + (f.length() / 1024 / 1024) + " MB)");
            try {
                long[] handles = nativeLoadModel(
                    path,
                    DEFAULT_N_CTX,
                    DEFAULT_N_GPU_LAYERS,
                    DEFAULT_N_THREADS
                );
                if (handles == null || handles[0] == 0 || handles[1] == 0) {
                    Log.e(TAG, "nativeLoadModel returned null or zero handles");
                    return false;
                }
                modelHandle   = handles[0];
                contextHandle = handles[1];
                modelLoaded   = true;
                loadedModelPath = path;
                Log.i(TAG, "Model loaded. model=" + modelHandle + " ctx=" + contextHandle);
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "loadModel native error: " + t.getMessage(), t);
                return false;
            }
        }
    }

    /**
     * Run inference on the loaded model. Blocking.
     * @param prompt  Full ChatML-formatted prompt
     * @return       Generated text, or null on error/cancel
     */
    public String chat(String prompt) {
        if (!nativeLibLoaded || !modelLoaded || contextHandle == 0) return null;
        cancelFlag.set(false);
        try {
            return nativeCompletion(contextHandle, prompt, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, cancelFlag);
        } catch (Throwable t) {
            Log.e(TAG, "chat native error: " + t.getMessage(), t);
            return null;
        }
    }

    /** Request cancellation of ongoing inference. */
    public void cancel() {
        cancelFlag.set(true);
    }

    /** Unload model and free native memory. */
    public void unloadModel() {
        synchronized (lock) { doUnload(); }
    }

    // ── Device capabilities ─────────────────────────────────────────────────

    public long getAvailableRamMb(Context ctx) {
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return -1;
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            return mi.availMem / 1024 / 1024;
        } catch (Exception e) { return -1; }
    }

    public long getTotalRamMb(Context ctx) {
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return -1;
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            return mi.totalMem / 1024 / 1024;
        } catch (Exception e) { return -1; }
    }

    public long getFreeStorageMb(Context ctx) {
        try {
            StatFs stat = new StatFs(ctx.getFilesDir().getPath());
            return stat.getAvailableBlocksLong() * stat.getBlockSizeLong() / 1024 / 1024;
        } catch (Exception e) { return -1; }
    }

    public String getPrimaryAbi() {
        return android.os.Build.SUPPORTED_ABIS != null && android.os.Build.SUPPORTED_ABIS.length > 0
            ? android.os.Build.SUPPORTED_ABIS[0] : "unknown";
    }

    // ── Private ─────────────────────────────────────────────────────────────

    private void doUnload() {
        if (modelLoaded) {
            try {
                if (contextHandle != 0) nativeFreeContext(contextHandle);
                if (modelHandle   != 0) nativeFreeModel(modelHandle);
            } catch (Throwable t) {
                Log.w(TAG, "doUnload error: " + t.getMessage());
            }
            contextHandle   = 0;
            modelHandle     = 0;
            modelLoaded     = false;
            loadedModelPath = null;
            Log.i(TAG, "Model unloaded");
        }
    }

    // ── Native method declarations ───────────────────────────────────────────
    // Implemented in android/app/src/main/cpp/mesaai_jni.cpp

    /**
     * Load model + create context.
     * @return long[2]: {modelHandle, contextHandle}, or null on failure.
     */
    private native long[] nativeLoadModel(String path, int nCtx, int nGpuLayers, int nThreads);

    /**
     * Run completion. cancelFlag is checked between tokens.
     * @return generated text (without the prompt), or null if cancelled/error.
     */
    private native String nativeCompletion(long ctx, String prompt, int maxTokens, float temperature, AtomicBoolean cancelFlag);

    /** Free the llama_context. */
    private native void nativeFreeContext(long ctx);

    /** Free the llama_model. */
    private native void nativeFreeModel(long model);
}
