cmake_minimum_required(VERSION 3.22)
project(dsjni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# melonDS (third_party/melonds, GPL-3.0) is prebuilt per-ABI as a static
# lib -- see third_party/melonds/build-android-<abi>/, produced the same
# way gbacore prebuilds mGBA (its own CMake project configured directly
# with the NDK toolchain -- see docs/melonds-setup.md for the exact
# commands). Re-run that configure+build for a given ${ANDROID_ABI} if
# this fails to find a libcore.a for it.
set(MELONDS_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../third_party/melonds)
set(MELONDS_BUILD_DIR ${MELONDS_ROOT}/build-android-${ANDROID_ABI})

add_library(melonds_core STATIC IMPORTED)
set_target_properties(melonds_core PROPERTIES IMPORTED_LOCATION ${MELONDS_BUILD_DIR}/src/libcore.a)
target_include_directories(melonds_core INTERFACE
    ${MELONDS_ROOT}/src
    ${MELONDS_BUILD_DIR}/src
)

# teakra (DSi DSP emulation, bundled inside melonDS's own source tree) is
# a separate static lib that core links against -- see
# third_party/melonds/src/teakra/.
add_library(teakra STATIC IMPORTED)
set_target_properties(teakra PROPERTIES IMPORTED_LOCATION ${MELONDS_BUILD_DIR}/src/teakra/src/libteakra.a)

add_library(dsjni SHARED
    ds_jni.cpp
    ds_platform.cpp
)

# melonds_core is an IMPORTED target (a prebuilt .a, not a real CMake
# subproject) -- its own target_compile_definitions(core PUBLIC
# OGLRENDERER_ENABLED ...) has no way to propagate here, so ds_jni.cpp
# needs the same definition repeated directly for GPU3D_OpenGL.h's
# GLRenderer declaration to be visible (it's `#ifdef OGLRENDERER_ENABLED`
# gated -- see docs/melonds-setup.md).
target_compile_definitions(dsjni PRIVATE OGLRENDERER_ENABLED "MELONDS_GL_HEADER=<GLES3/gl32.h>")

# Same imported-target propagation gap as OGLRENDERER_ENABLED above, but
# far nastier: NDS.h has a `bool EnableJIT;` *data member* gated behind
# `#ifdef JIT_ENABLED` (not just declarations), so sizeof(NDS) genuinely
# differs between a translation unit that sees this define and one that
# doesn't. Without repeating it here, melonds_core's own compiled
# NDS/ARMJIT constructors (built with JIT_ENABLED, sizeof(NDS) includes
# EnableJIT) run against a buffer that ds_jni.cpp's
# std::make_unique<NDS>(...) sized using its own (smaller, without
# EnableJIT) sizeof(NDS) -- a real ODR violation, confirmed root cause of
# a heap-buffer-overflow (via ASan) inside ARMJIT's constructor,
# corrupting memory immediately on ROM load whenever JIT is on.
#
# Only arm64-v8a's core.a is actually built with ENABLE_JIT=ON (see
# docs/melonds-setup.md) -- melonDS's JIT has no host backend for 32-bit
# ARM at all, and x86_64 (used for the emulator, not real devices) was
# never rebuilt with it -- so this must match per-ABI, not come from one
# blanket ENABLE_JIT passed to every ABI's dsjni configure.
if (ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_definitions(dsjni PRIVATE JIT_ENABLED)
endif()

find_library(log-lib log)
find_library(egl-lib EGL)
find_library(gles-lib GLESv3)
# ANativeWindow_fromSurface/release/getWidth/getHeight -- used to turn
# DsView's SurfaceView Surface into an EGL window surface (ds_jni.cpp's
# nativeSetSurface).
find_library(android-lib android)

target_link_libraries(dsjni PRIVATE melonds_core teakra ${log-lib} ${egl-lib} ${gles-lib} ${android-lib})
