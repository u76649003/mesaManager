cmake_minimum_required(VERSION 3.22.1)
project("mesaai")

# ── Build options ────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(LLAMA_CLBLAST OFF)
set(GGML_OPENMP   OFF)   # disable OpenMP to reduce APK size

# ── llama.cpp source directory ───────────────────────────────────────────────
# llama.cpp is cloned as a git submodule at android/app/src/main/cpp/llama.cpp
set(LLAMA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp")

# Verify llama.cpp source exists
if(NOT EXISTS "${LLAMA_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
        "llama.cpp source not found at ${LLAMA_DIR}.\n"
        "Run: git submodule add https://github.com/ggml-org/llama.cpp android/app/src/main/cpp/llama.cpp\n"
        "Then: git submodule update --init --recursive"
    )
endif()

# ── Include llama.cpp ────────────────────────────────────────────────────────
# Build only what we need (no server, no examples)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
add_subdirectory(${LLAMA_DIR} llama_build)

# ── JNI bridge ───────────────────────────────────────────────────────────────
add_library(
    mesaai            # name of the .so: libmesaai.so
    SHARED
    mesaai_jni.cpp    # our JNI implementation
)

# Link against llama.cpp and Android log
target_link_libraries(
    mesaai
    llama
    ggml
    android
    log
)

target_include_directories(
    mesaai PRIVATE
    ${LLAMA_DIR}
    ${LLAMA_DIR}/include
    ${LLAMA_DIR}/ggml/include
)
