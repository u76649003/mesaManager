package com.mesamanager.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * LocalAIPlugin — Capacitor bridge for llama.cpp local inference.
 *
 * Exposes to JavaScript:
 *   isSupported()           → { supported: boolean }
 *   getDeviceCapabilities() → { ramMb, totalRamMb, freeMb, architecture, nativeLibsAvailable }
 *   isModelInstalled()      → { installed: boolean, path?: string, sizeMb?: number }
 *   loadModel({ path })     → { loaded: boolean }
 *   chat({ messages, tools }) → { content: string, toolCall?: { name, arguments } }
 *   cancel()                → void
 *   unloadModel()           → void
 *   downloadModel({ url, filename }) → void (emits 'downloadProgress' events)
 *   deleteModel({ filename }) → { deleted: boolean }
 *
 * Default model: Qwen2.5-0.5B-Instruct Q4_K_M
 */
@CapacitorPlugin(name = "LocalAI")
public class LocalAIPlugin extends Plugin {

    private static final String TAG = "LocalAIPlugin";
    private static final String DEFAULT_MODEL_FILENAME = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
    private static final String DEFAULT_MODEL_URL =
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Future<?> activeDownload = null;
    private LocalAIEngine engine;

    @Override
    public void load() {
        engine = LocalAIEngine.getInstance();
        engine.init();
        Log.i(TAG, "LocalAIPlugin loaded. JNI available: " + engine.isNativeAvailable());
    }

    // ── isSupported ─────────────────────────────────────────────────────────

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", engine.isNativeAvailable());
        call.resolve(result);
    }

    // ── getDeviceCapabilities ────────────────────────────────────────────────

    @PluginMethod
    public void getDeviceCapabilities(PluginCall call) {
        Context ctx = getContext();
        JSObject result = new JSObject();
        result.put("ramMb",             engine.getAvailableRamMb(ctx));
        result.put("totalRamMb",        engine.getTotalRamMb(ctx));
        result.put("freeStorageMb",     engine.getFreeStorageMb(ctx));
        result.put("architecture",      engine.getPrimaryAbi());
        result.put("androidSdk",        android.os.Build.VERSION.SDK_INT);
        result.put("nativeLibsAvailable", engine.isNativeAvailable());
        result.put("recommendedContext", 2048);
        call.resolve(result);
    }

    // ── isModelInstalled ─────────────────────────────────────────────────────

    @PluginMethod
    public void isModelInstalled(PluginCall call) {
        String filename = call.getString("filename", DEFAULT_MODEL_FILENAME);
        File modelFile = getModelFile(filename);
        JSObject result = new JSObject();
        if (modelFile.exists() && modelFile.length() > 1024 * 1024) {
            result.put("installed", true);
            result.put("path",   modelFile.getAbsolutePath());
            result.put("sizeMb", modelFile.length() / 1024 / 1024);
            result.put("model",  filename);
        } else {
            result.put("installed", false);
        }
        call.resolve(result);
    }

    // ── loadModel ────────────────────────────────────────────────────────────

    @PluginMethod
    public void loadModel(PluginCall call) {
        String path = call.getString("path");
        String filename = call.getString("filename", DEFAULT_MODEL_FILENAME);

        if (path == null || path.isEmpty()) {
            path = getModelFile(filename).getAbsolutePath();
        }
        final String modelPath = path;

        executor.submit(() -> {
            boolean ok = engine.loadModel(modelPath);
            JSObject result = new JSObject();
            result.put("loaded", ok);
            if (!ok) {
                result.put("error", "No se pudo cargar el modelo. Comprueba que está instalado y hay suficiente RAM.");
            }
            mainHandler.post(() -> call.resolve(result));
        });
    }

    // ── chat ─────────────────────────────────────────────────────────────────

    @PluginMethod
    public void chat(PluginCall call) {
        if (!engine.isNativeAvailable()) {
            JSObject err = new JSObject();
            err.put("available", false);
            err.put("error", "IA local no disponible en este dispositivo.");
            call.resolve(err);
            return;
        }
        if (!engine.isModelLoaded()) {
            JSObject err = new JSObject();
            err.put("available", false);
            err.put("error", "Modelo no cargado. Instala el modelo primero.");
            call.resolve(err);
            return;
        }

        JSArray messagesArr = call.getArray("messages");
        JSArray toolsArr    = call.getArray("tools");

        if (messagesArr == null) {
            call.reject("messages is required");
            return;
        }

        executor.submit(() -> {
            try {
                // Build ChatML prompt from messages
                String prompt = buildChatMLPrompt(messagesArr, toolsArr);
                Log.d(TAG, "chat() prompt built, length=" + prompt.length());

                String output = engine.chat(prompt);

                JSObject result = new JSObject();
                if (output == null) {
                    result.put("available", false);
                    result.put("error", "La inferencia fue cancelada o falló.");
                } else {
                    result.put("available", true);
                    parseModelOutput(output, result);
                }
                mainHandler.post(() -> call.resolve(result));
            } catch (Exception e) {
                Log.e(TAG, "chat error: " + e.getMessage(), e);
                JSObject err = new JSObject();
                err.put("available", false);
                err.put("error", e.getMessage());
                mainHandler.post(() -> call.resolve(err));
            }
        });
    }

    // ── cancel ───────────────────────────────────────────────────────────────

    @PluginMethod
    public void cancel(PluginCall call) {
        engine.cancel();
        call.resolve();
    }

    // ── unloadModel ──────────────────────────────────────────────────────────

    @PluginMethod
    public void unloadModel(PluginCall call) {
        executor.submit(() -> {
            engine.unloadModel();
            mainHandler.post(call::resolve);
        });
    }

    // ── downloadModel ────────────────────────────────────────────────────────

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url      = call.getString("url", DEFAULT_MODEL_URL);
        String filename = call.getString("filename", DEFAULT_MODEL_FILENAME);

        if (activeDownload != null && !activeDownload.isDone()) {
            call.reject("Ya hay una descarga en curso.");
            return;
        }

        File target = getModelFile(filename);
        File tmpFile = new File(target.getParentFile(), filename + ".tmp");

        activeDownload = executor.submit(() -> {
            HttpURLConnection conn = null;
            InputStream is = null;
            FileOutputStream fos = null;
            try {
                Log.i(TAG, "Downloading model from: " + url);
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestProperty("User-Agent", "MesaManager/3.1");
                conn.connect();

                int responseCode = conn.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    emitDownloadError("HTTP " + responseCode);
                    mainHandler.post(call::resolve);
                    return;
                }

                long totalBytes = conn.getContentLengthLong();
                is  = conn.getInputStream();
                fos = new FileOutputStream(tmpFile);

                byte[] buf = new byte[8192];
                long downloaded = 0;
                int read;
                long lastEmit = 0;

                while ((read = is.read(buf)) != -1) {
                    fos.write(buf, 0, read);
                    downloaded += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 500) { // emit every 500ms
                        lastEmit = now;
                        final long dl = downloaded;
                        final long total = totalBytes;
                        mainHandler.post(() -> {
                            JSObject evt = new JSObject();
                            evt.put("downloaded", dl);
                            evt.put("total",      total);
                            evt.put("progress",   total > 0 ? (int)(dl * 100 / total) : 0);
                            notifyListeners("downloadProgress", evt, false);
                        });
                    }
                }
                fos.flush();
                fos.close();
                is.close();
                conn.disconnect();

                // Rename tmp → final
                if (target.exists()) target.delete();
                if (!tmpFile.renameTo(target)) {
                    emitDownloadError("No se pudo mover el archivo descargado.");
                    mainHandler.post(call::resolve);
                    return;
                }

                Log.i(TAG, "Download complete: " + target.getAbsolutePath() + " (" + target.length() / 1024 / 1024 + " MB)");

                // Emit 100%
                mainHandler.post(() -> {
                    JSObject evt = new JSObject();
                    evt.put("downloaded", target.length());
                    evt.put("total",      target.length());
                    evt.put("progress",   100);
                    evt.put("complete",   true);
                    evt.put("path",       target.getAbsolutePath());
                    notifyListeners("downloadProgress", evt, false);
                });
                mainHandler.post(call::resolve);

            } catch (IOException e) {
                Log.e(TAG, "Download error: " + e.getMessage(), e);
                if (tmpFile.exists()) tmpFile.delete();
                emitDownloadError(e.getMessage());
                mainHandler.post(call::resolve);
            } finally {
                try { if (is  != null) is.close();  } catch (Exception ignored) {}
                try { if (fos != null) fos.close(); } catch (Exception ignored) {}
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ── deleteModel ──────────────────────────────────────────────────────────

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String filename = call.getString("filename", DEFAULT_MODEL_FILENAME);
        engine.unloadModel(); // unload first if this is the loaded model
        File f = getModelFile(filename);
        boolean deleted = f.exists() && f.delete();
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private File getModelFile(String filename) {
        File dir = new File(getContext().getFilesDir(), "models");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, filename);
    }

    private void emitDownloadError(String msg) {
        mainHandler.post(() -> {
            JSObject evt = new JSObject();
            evt.put("error", msg);
            notifyListeners("downloadProgress", evt, false);
        });
    }

    /**
     * Build a ChatML-formatted prompt from the messages array.
     * Qwen2.5 uses ChatML format:
     * <|im_start|>role\ncontent<|im_end|>
     */
    private String buildChatMLPrompt(JSArray messagesArr, JSArray toolsArr) {
        StringBuilder sb = new StringBuilder();

        try {
            // Inject tools description into system prompt if tools are provided
            String toolsDesc = buildToolsDescription(toolsArr);

            for (int i = 0; i < messagesArr.length(); i++) {
                JSObject msg = JSObject.fromJSONObject(messagesArr.getJSONObject(i));
                if (msg == null) continue;
                String role    = msg.getString("role", "user");
                String content = msg.getString("content", "");

                // Inject tools description after system prompt
                if ("system".equals(role) && !toolsDesc.isEmpty()) {
                    content = content + "\n\n" + toolsDesc;
                }

                sb.append("<|im_start|>").append(role).append("\n");
                sb.append(content);
                sb.append("<|im_end|>\n");
            }
        } catch (Exception e) {
            Log.e(TAG, "buildChatMLPrompt error: " + e.getMessage());
        }

        // Add assistant turn start
        sb.append("<|im_start|>assistant\n");
        return sb.toString();
    }

    /**
     * Build a compact tools description injected into the system prompt.
     * The model will output JSON tool calls when it wants to use a tool.
     */
    private String buildToolsDescription(JSArray toolsArr) {
        if (toolsArr == null || toolsArr.length() == 0) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("HERRAMIENTAS DISPONIBLES (responde con JSON si quieres usar una):\n");
        try {
            for (int i = 0; i < toolsArr.length(); i++) {
                JSObject tool = JSObject.fromJSONObject(toolsArr.getJSONObject(i));
                if (tool == null) continue;
                JSObject fn = tool.has("function") ? JSObject.fromJSONObject(tool.getJSONObject("function")) : null;
                if (fn == null) continue;
                String name = fn.getString("name", "");
                String desc = fn.getString("description", "");
                sb.append("- ").append(name).append(": ").append(desc).append("\n");
            }
            sb.append("\nPara llamar a una herramienta responde SOLO con JSON en este formato:\n");
            sb.append("{\"tool\":\"nombre_herramienta\",\"arguments\":{...}}\n");
            sb.append("Para respuesta de texto normal, responde directamente en español.\n");
        } catch (Exception e) {
            Log.e(TAG, "buildToolsDescription error: " + e.getMessage());
        }
        return sb.toString();
    }

    /**
     * Parse the model output and populate the result JSObject.
     * Looks for a JSON tool call or plain text response.
     */
    private void parseModelOutput(String output, JSObject result) {
        if (output == null || output.trim().isEmpty()) {
            result.put("content", "");
            result.put("finish_reason", "stop");
            return;
        }

        String trimmed = output.trim();

        // Try to parse as JSON tool call
        // Look for JSON object that has "tool" key
        int jsonStart = trimmed.indexOf('{');
        int jsonEnd   = trimmed.lastIndexOf('}');

        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            String jsonStr = trimmed.substring(jsonStart, jsonEnd + 1);
            try {
                // Simple JSON parsing for tool calls
                org.json.JSONObject json = new org.json.JSONObject(jsonStr);
                if (json.has("tool")) {
                    String toolName = json.getString("tool");
                    org.json.JSONObject arguments = json.optJSONObject("arguments");
                    String argsStr = arguments != null ? arguments.toString() : "{}";

                    // Build OpenAI-compatible tool_calls structure
                    org.json.JSONArray toolCallsJson = new org.json.JSONArray();
                    org.json.JSONObject tc = new org.json.JSONObject();
                    tc.put("id", "call_" + System.currentTimeMillis());
                    tc.put("type", "function");
                    org.json.JSONObject fn = new org.json.JSONObject();
                    fn.put("name", toolName);
                    fn.put("arguments", argsStr);
                    tc.put("function", fn);
                    toolCallsJson.put(tc);

                    result.put("content", "");
                    result.put("finish_reason", "tool_calls");
                    result.put("tool_calls_json", toolCallsJson.toString());
                    Log.d(TAG, "Parsed tool call: " + toolName + " args=" + argsStr);
                    return;
                }
            } catch (org.json.JSONException e) {
                Log.d(TAG, "Not a JSON tool call, treating as text");
            }
        }

        // Plain text response
        // Remove ChatML tokens if model included them
        String content = trimmed
            .replace("<|im_end|>", "")
            .replace("<|im_start|>", "")
            .replace("<|endoftext|>", "")
            .trim();

        result.put("content", content);
        result.put("finish_reason", "stop");
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        engine.unloadModel();
    }
}
