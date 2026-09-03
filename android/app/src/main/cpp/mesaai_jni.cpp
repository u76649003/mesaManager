/**
 * mesaai_jni.cpp — JNI bridge between Java LocalAIEngine and llama.cpp
 *
 * Java class: com.mesamanager.app.LocalAIEngine
 * Native lib: libmesaai.so
 *
 * Compile: NDK + CMake (see CMakeLists.txt)
 * Dependencies: llama.cpp (git submodule at ./llama.cpp)
 */

#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <atomic>

// llama.cpp headers
#include "llama.h"
#include "ggml.h"

#define LOG_TAG "MesaAI_JNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

// ── Utility: get AtomicBoolean value ────────────────────────────────────────

static bool atomicBoolGet(JNIEnv* env, jobject atomicBoolean) {
    jclass cls = env->GetObjectClass(atomicBoolean);
    jmethodID getMethod = env->GetMethodID(cls, "get", "()Z");
    return env->CallBooleanMethod(atomicBoolean, getMethod);
}

// ── Struct to hold llama state ───────────────────────────────────────────────

struct LlamaContext {
    llama_context* ctx;
    llama_sampler* smpl;
    llama_model*   model; // backref
};

// ── JNI: nativeLoadModel ─────────────────────────────────────────────────────

extern "C"
JNIEXPORT jlongArray JNICALL
Java_com_mesamanager_app_LocalAIEngine_nativeLoadModel(
    JNIEnv* env,
    jobject /* this */,
    jstring jpath,
    jint    nCtx,
    jint    nGpuLayers,
    jint    nThreads
) {
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    LOGI("Loading model: %s (nCtx=%d, gpu=%d, threads=%d)", path, nCtx, nGpuLayers, nThreads);

    // Load model
    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = nGpuLayers;

    llama_model* model = llama_model_load_from_file(path, mparams);
    env->ReleaseStringUTFChars(jpath, path);

    if (!model) {
        LOGE("Failed to load model");
        return nullptr;
    }

    // Create context
    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx     = (uint32_t)nCtx;
    cparams.n_threads = (uint32_t)nThreads;
    cparams.n_threads_batch = (uint32_t)nThreads;

    llama_context* ctx = llama_new_context_with_model(model, cparams);
    if (!ctx) {
        LOGE("Failed to create context");
        llama_model_free(model);
        return nullptr;
    }

    // Create sampler chain (low temperature for structured output)
    llama_sampler* smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(0.1f));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    // Pack into a struct
    auto* state = new LlamaContext{ ctx, smpl, model };

    LOGI("Model loaded. model=%p ctx=%p", (void*)model, (void*)ctx);

    // Return as long[2]: { (jlong)modelPtr, (jlong)ctxStructPtr }
    jlongArray result = env->NewLongArray(2);
    jlong handles[2] = { (jlong)(uintptr_t)model, (jlong)(uintptr_t)state };
    env->SetLongArrayRegion(result, 0, 2, handles);
    return result;
}

// ── JNI: nativeCompletion ────────────────────────────────────────────────────

extern "C"
JNIEXPORT jstring JNICALL
Java_com_mesamanager_app_LocalAIEngine_nativeCompletion(
    JNIEnv*  env,
    jobject  /* this */,
    jlong    jctxStruct,
    jstring  jprompt,
    jint     maxTokens,
    jfloat   temperature,
    jobject  jcancelFlag
) {
    auto* state = reinterpret_cast<LlamaContext*>((uintptr_t)jctxStruct);
    if (!state || !state->ctx || !state->model) {
        LOGE("nativeCompletion: invalid state");
        return nullptr;
    }

    const char* prompt = env->GetStringUTFChars(jprompt, nullptr);
    LOGD("Completion prompt length: %zu", strlen(prompt));

    llama_context* ctx   = state->ctx;
    llama_model*   model = state->model;
    llama_sampler* smpl  = state->smpl;

    // Tokenize prompt
    const int n_prompt = -llama_tokenize(model, prompt, strlen(prompt), nullptr, 0, true, true);
    std::vector<llama_token> tokens_prompt(n_prompt);
    if (llama_tokenize(model, prompt, strlen(prompt), tokens_prompt.data(), n_prompt, true, true) < 0) {
        LOGE("Tokenization failed");
        env->ReleaseStringUTFChars(jprompt, prompt);
        return nullptr;
    }
    env->ReleaseStringUTFChars(jprompt, prompt);

    LOGD("Prompt tokens: %d", n_prompt);

    // Evaluate prompt
    llama_batch batch = llama_batch_get_one(tokens_prompt.data(), tokens_prompt.size());
    if (llama_decode(ctx, batch) != 0) {
        LOGE("llama_decode failed on prompt");
        return nullptr;
    }

    // Generate tokens
    std::string output;
    int n_generated = 0;
    const int vocab_size = llama_vocab_n_tokens(llama_model_get_vocab(model));

    while (n_generated < maxTokens) {
        // Check cancel flag
        if (jcancelFlag && atomicBoolGet(env, jcancelFlag)) {
            LOGI("Generation cancelled after %d tokens", n_generated);
            break;
        }

        llama_token token_id = llama_sampler_sample(smpl, ctx, -1);

        // EOS or EOT?
        if (llama_vocab_is_eog(llama_model_get_vocab(model), token_id)) {
            LOGD("EOS token at %d", n_generated);
            break;
        }

        // Decode token to string
        char buf[256];
        int n = llama_token_to_piece(llama_model_get_vocab(model), token_id, buf, sizeof(buf) - 1, 0, true);
        if (n < 0) n = 0;
        buf[n] = '\0';
        output += buf;
        n_generated++;

        // Stop on ChatML end token
        if (output.find("<|im_end|>") != std::string::npos ||
            output.find("<|endoftext|>") != std::string::npos) {
            break;
        }

        // Feed back generated token
        batch = llama_batch_get_one(&token_id, 1);
        if (llama_decode(ctx, batch) != 0) {
            LOGE("llama_decode failed on token %d", n_generated);
            break;
        }
    }

    // Clean up ChatML tokens from output
    auto strip = [&](const std::string& marker) {
        size_t pos;
        while ((pos = output.find(marker)) != std::string::npos) {
            output.erase(pos, marker.size());
        }
    };
    strip("<|im_end|>");
    strip("<|im_start|>");
    strip("<|endoftext|>");

    // Trim
    while (!output.empty() && (output.front() == '\n' || output.front() == ' ')) output.erase(0, 1);
    while (!output.empty() && (output.back()  == '\n' || output.back()  == ' ')) output.pop_back();

    LOGI("Generated %d tokens, output length=%zu", n_generated, output.size());

    // Reset context KV cache for next call
    llama_kv_cache_clear(ctx);

    return env->NewStringUTF(output.c_str());
}

// ── JNI: nativeFreeContext ───────────────────────────────────────────────────

extern "C"
JNIEXPORT void JNICALL
Java_com_mesamanager_app_LocalAIEngine_nativeFreeContext(
    JNIEnv* /* env */,
    jobject /* this */,
    jlong   jctxStruct
) {
    auto* state = reinterpret_cast<LlamaContext*>((uintptr_t)jctxStruct);
    if (!state) return;
    if (state->smpl) llama_sampler_free(state->smpl);
    if (state->ctx)  llama_free(state->ctx);
    delete state;
    LOGI("Context freed");
}

// ── JNI: nativeFreeModel ─────────────────────────────────────────────────────

extern "C"
JNIEXPORT void JNICALL
Java_com_mesamanager_app_LocalAIEngine_nativeFreeModel(
    JNIEnv* /* env */,
    jobject /* this */,
    jlong   jmodel
) {
    auto* model = reinterpret_cast<llama_model*>((uintptr_t)jmodel);
    if (model) {
        llama_model_free(model);
        LOGI("Model freed");
    }
}
