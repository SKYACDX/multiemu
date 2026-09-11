# third_party/melonds (NDS emulation core)

[melonDS](https://github.com/melonDS-emu/melonDS), **GPL-3.0** (note: this
is stronger copyleft than mGBA's MPL-2.0 -- statically linking it into
the app is a GPL-covered combined work; source availability obligations
apply to any distribution of a build that includes it).

dscore links against melonDS's `libcore.a` the same way gbacore links
against mGBA's `libmgba.a` -- see `app/android/dscore/src/main/cpp/`.

Clone at the pinned tag:

```bash
git clone --depth 1 --branch 1.1 https://github.com/melonDS-emu/melonDS.git third_party/melonds
```

Then, for each ABI dscore builds for (arm64-v8a, armeabi-v7a, x86_64),
configure and build just the `core` static lib (no Qt/SDL frontend, no
GL renderer, no JIT, no GDB stub -- see below for why):

```bash
cmake -GNinja -S third_party/melonds -B third_party/melonds/build-android-<ABI> \
  -DCMAKE_MAKE_PROGRAM=<path-to-ninja> \
  -DCMAKE_TOOLCHAIN_FILE=<NDK>/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=<ABI> -DANDROID_PLATFORM=android-24 \
  -DBUILD_QT_SDL=OFF -DENABLE_OGLRENDERER=OFF -DENABLE_GDBSTUB=OFF -DENABLE_JIT=OFF \
  -DCMAKE_BUILD_TYPE=Release

cmake --build third_party/melonds/build-android-<ABI> --target core
```

Notes on the flags:

- **`-GNinja` is required.** CMake's default generator on Windows is
  Visual Studio, which does not cross-compile correctly against the NDK
  toolchain file -- Gradle's own CMake integration always uses Ninja
  internally, so this matches that. The Android SDK's `cmake` package
  ships a `ninja` binary alongside `cmake` if one isn't on PATH.
- **`ENABLE_JIT=OFF`**: melonDS's JIT recompiles guest ARM code to host
  machine code at runtime: fast, but a correctness- and stability-risk
  multiplier on a brand-new integration. Interpreter-only first; JIT can
  be revisited once a ROM is confirmed booting and playable.
- **`ENABLE_OGLRENDERER=OFF`**: software 3D renderer only for now, same
  reasoning -- fewer moving parts while bringing this up. melonDS's
  software renderer is what real hardware output looks like pixel-for-
  pixel-ish; OpenGL is a (faster, less accurate) upgrade path.
- `teakra` (DSi DSP emulation) is vendored inside melonDS's own source
  tree (`third_party/melonds/src/teakra/`), not a separate clone -- it
  builds automatically as part of the `core` target and produces its own
  `libteakra.a` that `core` links against. `core.a` alone is not
  sufficient; dscore's CMakeLists.txt imports both.

`app/android/dscore/src/main/cpp/CMakeLists.txt` expects
`third_party/melonds/build-android-${ANDROID_ABI}/src/libcore.a` and
`.../src/teakra/src/libteakra.a` to exist for each ABI in
`dscore/build.gradle`'s `abiFilters` -- run the above for all three
before building the app.

## Why this needed more than just linking a library (unlike mGBA)

mGBA ships a complete, frontend-agnostic C API (`mCore`) -- gba_jni.cpp
is a thin passthrough with no platform-abstraction work of its own.
melonDS's `core` library, by contrast, declares but does not define a
whole `Platform::` namespace (`third_party/melonds/src/Platform.h`) that
a frontend must implement: file I/O, threading/mutex/semaphore
primitives, logging, save/firmware persistence, local wireless
multiplayer, internet play, and DSi peripherals (camera, mic, AAC audio,
rumble/motion addons). Its own Qt/SDL frontend normally provides this;
we can't use that on Android, so `ds_platform.cpp` implements it
directly instead.

Current status of that implementation (`app/android/dscore/src/main/cpp/ds_platform.cpp`):

- **Fully implemented**: file I/O (via `fopen`/`fread`/etc.), threading
  (`std::thread`/`std::mutex`/POSIX semaphores), logging (to
  `__android_log_print`), timing, and NDS cartridge save writeback.
- **Stubbed as safe no-ops** (compiles and links, but doesn't do
  anything real yet): local wireless multiplayer, internet play, DSi
  camera/mic/AAC audio, and Guitar Grip/Rumble Pak/Motion Pak addons.
  None of these block a single-player commercial ROM from booting and
  playing.
- **Verified**: the whole thing (`ds_jni.cpp` + `ds_platform.cpp` +
  `libcore.a` + `libteakra.a`) links with zero unresolved
  `melonDS::Platform::*` symbols under `-Wl,--no-undefined` (checked by
  hand against all three ABIs, then confirmed again on the actual
  Gradle-built `.so` with `llvm-nm -D -u`) -- this is a real signal the
  library will `System.loadLibrary()` successfully on-device, not just
  that the source compiles.

## What's not done yet (as of initial bring-up)

No NDS instance is actually constructed or ROM loaded yet
(`ds_jni.cpp` only exposes a version-probe function so far). The next
piece is a BIOS/firmware strategy: melonDS supports a built-in
"FreeBIOS" fallback (an open-source reimplementation, no real Nintendo
BIOS/firmware dump required) that many commercial ROMs boot fine under
-- that's the path to take here rather than asking the user to supply
copyrighted BIOS files, and is the natural next step before writing the
actual `nativeCreate`/`loadROM`/`runFrame` JNI functions, the dual-
screen Kotlin view, and touch-screen input mapping.

(Note: everything above describes the state at initial bring-up. ROM
loading, save persistence, the dual-screen view, and touch input have
all been working and shipped for a while now -- see the two
performance investigations below, done once that was true.)

## Performance investigation #1: enabling the JIT (abandoned)

Tried in response to a real report: SoulSilver runs noticeably slower
than a standalone melonDS app, especially outdoors (HGSS's overworld is
3D-rendered, so more geometry outdoors = more CPU-bound interpreter
work). JIT is normally the single biggest speed lever for any emulator.

Found and fixed two real bugs along the way:

- **`ds_platform.cpp`'s `DynamicLibrary_Load`/`LoadFunction` were
  stubs that always returned null.** melonDS's own `ARMJIT_Memory.cpp`
  already tries the *correct*, modern Android API for JIT fastmem
  (`ASharedMemory_create`, looked up at runtime via `dlopen("libandroid.so")`
  since it's only available API 26+) before falling back to opening
  `/dev/ashmem` directly -- but our stub made that lookup always fail,
  silently forcing every build onto the ashmem fallback, which SELinux
  blocks for regular apps on modern Android (`open` denied -> bad fd ->
  crash on the following `ftruncate`/`mmap`). Fixed with real
  `dlopen`/`dlsym`/`dlclose`.
- **melonDS's own `ARMJIT_Memory.cpp` calls `ftruncate` unconditionally**
  after sizing the fastmem region, even on the `ASharedMemory_create`
  path where the region is already sized at creation -- redundant on
  desktop (harmless no-op) but fails outright on Android's memfd-backed
  ashmem regions (sealed against further resizing). Fixed by only
  calling it on the non-Android POSIX (`shm_open`) path, which is the
  only one that actually needs it.

Both fixes are real and still in place (harmless with JIT off). But
enabling `ENABLE_JIT=ON` after fixing both **still crashed** -- a third
time, with a plain `SIGSEGV` and no error log at all, confirmed via
`adb logcat` on a real arm64 device (Honor-branded, Snapdragon/Adreno,
not just the dev x86_64 emulator). Backtrace pointed into
`nativeGetFramebuffer` reading a wild pointer, consistent with the JIT
recompiler corrupting memory somewhere in the guest CPU emulation for
this specific game/instruction mix -- not something safely diagnosable
by inspection alone; would need ASan (see below) or a JIT-specific
fuzzing/bisection pass to isolate.

**Decision: left `ENABLE_JIT=OFF`.** Three distinct bugs deep with no
end in sight, for a core (melonDS 1.1 tag) that clearly hasn't had its
JIT path exercised much in this integration. Not worth the risk for a
performance nice-to-have when the interpreter already works reliably.

## Performance investigation #2: the OpenGL 3D renderer (abandoned)

Tried next, on the theory that the 3D *rendering* cost (not just CPU
interpretation) is what actually dominates outdoor scenes, and unlike
JIT, GLRenderer's C++ code has no per-architecture dynarec risk -- it's
ordinary portable code, safely testable on the x86_64 emulator too.

### What it takes to build (all done, all still in the code)

1. **`ENABLE_OGLRENDERER=ON`** when configuring melonDS (compiles
   `GPU3D_OpenGL.cpp`, `GPU_OpenGL.cpp`, `GPU3D_TexcacheOpenGL.cpp`,
   `OpenGLSupport.cpp`). Excluded `GPU3D_Compute.cpp` (an alternate,
   self-contained, never-referenced-elsewhere compute-shader renderer)
   from `third_party/melonds/src/CMakeLists.txt`'s source list --
   it uses desktop-only GL calls we'd have had to patch for no benefit,
   since nothing in our integration ever constructs `ComputeRenderer`.
2. **Point `PlatformOGL.h` at real GLES headers instead of melonDS's own
   glad** (a desktop-GL function loader that doesn't work on Android --
   GLES functions are directly-linkable symbols from `libGLESv3.so`, no
   runtime loader needed at all). Done via
   `target_compile_definitions(core PUBLIC "MELONDS_GL_HEADER=<GLES3/gl32.h>")`
   in melonDS's own `CMakeLists.txt` -- and, since `melonds_core` is an
   `IMPORTED` static-lib target in `dscore`'s `CMakeLists.txt` (a
   prebuilt `.a`, not a real CMake subproject), that definition doesn't
   propagate there automatically; `dscore/src/main/cpp/CMakeLists.txt`
   repeats both `OGLRENDERER_ENABLED` and the same `MELONDS_GL_HEADER`
   definition for `ds_jni.cpp` to see `GLRenderer`'s declaration.
3. **Patched real desktop-GL-vs-GLES API gaps** in
   `GPU3D_OpenGL.cpp`/`OpenGLSupport.cpp` (GLES has none of these):
   `glClearDepth`/`glDepthRange` (desktop-only, `GLdouble` args) ->
   `glClearDepthf`/`glDepthRangef`; `glDrawBuffer` -> `glDrawBuffers`
   with a 1-element array; `glMapBuffer` -> `glMapBufferRange` with an
   explicit range; `glBindFragDataLocation` (desktop-only, no GLES
   equivalent at all) -> removed, replaced by adding explicit
   `layout(location = N)` qualifiers directly in the fragment shader
   sources instead (the only way GLES has to assign output locations).
   `GL_BGRA` and `GL_UNSIGNED_SHORT_1_5_5_5_REV` aren't declared by
   GLES headers (desktop-core / extension-only) -- spelled out by their
   numeric values instead of pulling in `gl2ext.h` for two constants;
   confirmed present via `GL_EXT_read_format_bgra` /
   `GL_EXT_texture_format_BGRA8888` on the real test device (a live
   EGL/GLES capability probe is worth re-running on whatever device
   picks this back up, in case it lacks either extension).
4. **Ported every shader melonDS actually uses to GLSL ES 3.20**
   (`GPU3D_OpenGL_shaders.h`'s `kShaderHeader`, plus
   `GPU_OpenGL_shaders.h`'s `kCompositorVS`/`kCompositorFS_Nearest` --
   the *other* shader variants in that file, `kCompositorFS_Linear` and
   the xBRZ ones, are dead code for us, never referenced by any C++
   call site, left untouched). Was desktop `#version 140`; GLSL ES
   needs explicit precision qualifiers and is considerably stricter
   about implicit int/float conversions than desktop GLSL -- every fix
   below came from an actual Adreno shader-compiler error message via
   `adb logcat`, not guesswork:
   - `mod(fTexcoord.y, 192)` -> `mod(fTexcoord.y, 192.0)` (int literal
     where a float overload was needed).
   - `vec2(...) * u3DScale` (a `uint` uniform) -> `... * float(u3DScale)`.
   - `oAttr.g = 0;` / `= 1;` style bare-int assignments to float
     components -> `0.0` / `1.0` throughout.
   - `(pixel.r>0) ? 1 : alpha0` (ternary mixing `int` and `float`
     branches) -> `1.0`.
   - `vcol.r * 31` (float * int literal) -> `* 31.0`.
   - `vec4(0,0,0,0)` / `vec4(0)` / `vec4(0,0,0,1)` constructors with
     bare int args -> explicit `.0` throughout (constructors are more
     lenient than binary ops here, but Adreno's compiler still balked).
   - `30.5/31` / `0.5/31` (float / int literal) -> `/ 31.0`.
5. **A real melonDS bug, not a portability gap**: `DownScaleBufferTex`
   (the final downscale target `PrepareCaptureFrame` blits into and
   reads back from) is `glGenTextures`'d and given texture parameters,
   but **never given a `glTexImage2D` call anywhere upstream** --
   `SetupDefaultTexParams` only sets wrap/filter, never allocates
   storage. Every other texture in the same function (`ColorBufferTex`,
   `DepthBufferTex`, `AttrBufferTex`) gets one; this one didn't. Without
   it, `DownscaleFramebuffer` is incomplete and the blit+`glReadPixels`
   silently produces nothing (an all-black frame, no GL error) --
   fixed by adding the missing `glTexImage2D(..., 256, 192, ...)` call
   in `SetRenderSettings`.
6. **EGL context + renderer wiring, all in `ds_jni.cpp`**: a headless
   (`EGL_PBUFFER_BIT`) GLES 3 context is created lazily on first
   `nativeRunFrame` (always the same OS thread -- DsView's Choreographer
   callback -- since EGL contexts are strictly thread-bound; creating
   it anywhere else and using GL from the frame thread would silently
   no-op). Renderer attach **must** go through `GPU::SetRenderer3D()`,
   *not* `GPU3D.SetCurrentRenderer()` directly -- the former also calls
   `InitFramebuffers()`, which resizes `GPU::Framebuffer` to the wider
   layout (`(256*3+1)*192` vs plain `256*192`) the accelerated path
   needs. Calling `SetCurrentRenderer` directly (our first attempt)
   skipped that resize, leaving `Framebuffer` allocated at the old,
   smaller size while `GPU2D_Soft.cpp`'s `DrawScanline` (which doesn't
   care which renderer is active) kept writing at the new, wider
   stride -- a heap-buffer-overflow confirmed with ASan (see below),
   not a crash whose cause was obvious from the segfault site alone
   (it surfaced inside unrelated 2D-compositor code). Also:
   `PrepareCaptureFrame()` isn't automatically called for display
   purposes -- it's normally only triggered by the DS's own VRAM-capture
   hardware feature (a `CaptureCnt` register bit real gameplay almost
   never sets); a real frontend has to call it itself every frame,
   which `nativeRunFrame` now does after `RunFrame()`.
7. **`nativeGetFramebuffer` needed two changes** for the wider
   accelerated `GPU::Framebuffer` stride: (a) a per-row strided copy
   (256 of every `256*3+1` columns -- the rest is per-scanline
   blend/brightness metadata for melonDS's own GL compositor, which
   this integration doesn't use) instead of one linear
   `SetIntArrayRegion`; (b) re-expanding each channel from the DS's
   native 6-bit depth back to 8-bit
   (`v = (v << 2) | (v >> 4)`) -- `GLRenderer::GetLine()` packs its
   output down to 6-bit-in-8-bit-slots to match the software 2D
   pipeline's own blend precision, and melonDS's GL compositor shader
   normally re-expands that as its last step before display
   (`pixel.rgb <<= 2; pixel.rgb |= pixel.rgb >> 6;`) -- skip it and
   everything reads at roughly 1/4 brightness.

### Where it got stuck

With all seven of the above in place, the renderer activates with no
crash and **does** render real 3D content -- confirmed visually on the
real test device: the SoulSilver intro logo (3D text/vertex-colored
geometry, no textures) rendered correctly, and the bottom-screen 2D
touch-menu (after the color-depth fix) showed correct, vivid colors.

But the actual **textured** overworld geometry (room walls, character
sprites -- anything using `TexMemID`/`TexPalMemID`) renders as solid
black, even after moving around and confirming it's not just a
transition screen. Untextured/vertex-colored 3D (the logo) works;
textured 3D doesn't. Root cause not yet found -- candidates worth
checking first if this gets picked up again:

- `TexMemID`/`TexPalMemID` upload correctness (`GL_R8UI`/`GL_RGB5_A1`
  formats look right on inspection, but weren't verified with a GPU
  frame-capture tool).
- Whether `RenderSceneChunk`/`BuildPolygons` actually submits any
  polygons with `PolygonAttr`'s texture-enable bits set, vs. silently
  dropping them.
- `GPU3D_TexcacheOpenGL.cpp` (compiled in, never audited for GLES
  compatibility beyond a quick grep -- came back clean, but wasn't
  exercised by anything that got this far in testing).

Confirmed **not** a memory-safety bug: rebuilt with a full ASan
instrumentation pass (see next section) and the black-texture behavior
persisted with zero ASan reports -- so this is a logic/state bug, not
corruption.

### Diagnosing on-device with ASan (real device, no root needed)

For chasing memory corruption specifically (used to find the
`SetRenderer3D` bug above), this actually worked well and is worth
reusing for anything similar in the future:

1. Build `core` (melonDS) **and** `dsjni` with matching
   `-fsanitize=address -fno-omit-frame-pointer` (compile) and
   `-fsanitize=address` (link) -- mixing sanitized and unsanitized
   objects in one process risks missing the actual out-of-bounds write,
   so both need it, not just one.
2. Copy the NDK's prebuilt ASan runtime
   (`toolchains/llvm/.../lib/clang/<ver>/lib/linux/libclang_rt.asan-aarch64-android.so`)
   into `dscore/src/main/jniLibs/arm64-v8a/`.
3. Add a `wrap.sh` under `app/src/main/resources/lib/arm64-v8a/wrap.sh`
   that does `LD_PRELOAD=.../libclang_rt.asan-....so exec "$@"` --
   Android's Zygote honors `wrap.sh` for a **debuggable** app even on a
   normal retail/user-build device (no root, no userdebug OS needed).
4. Build a **release** variant (so JS ships as a bundled asset, not
   requiring Metro reachable from the real device) with `debuggable
   true` forced on the release `buildType` -- the `debug` build type
   works too but needs Metro reachable over `adb reverse`.
5. `android.packagingOptions.jniLibs.useLegacyPackaging = true` is
   required too, or install fails with `INSTALL_FAILED_INVALID_APK:
   Failed to extract native libraries` -- modern AGP defaults to
   uncompressed/page-aligned native libs, which `wrap.sh`'s
   `LD_PRELOAD` needs to be a real extracted-to-disk file instead.
6. ASan reports (heap-buffer-overflow with exact size/offset, full
   backtrace) show up in `adb logcat` under the `wrap.sh` tag, not any
   `melonDS`/app tag. `llvm-addr2line -f -C -e <unstripped .so>
   <addr>...` against the *unstripped* `.so` (under
   `dscore/build/intermediates/cxx/RelWithDebInfo/.../obj/<abi>/`, not
   the final stripped one in the APK) resolves crash addresses to exact
   source lines/functions.

All of this (ASan flags, jniLibs, wrap.sh, `debuggable true`,
`useLegacyPackaging`) is marked `TEMPORARY` in the code and reverted
once the investigation stopped -- search for "ASan" / "diagnostic" in
`dscore/src/main/cpp/CMakeLists.txt`, `third_party/melonds/src/CMakeLists.txt`,
and `app/build.gradle` if it needs reviving.

### Decision + where the work is preserved

**Left `ENABLE_OGLRENDERER=OFF`.** Eight distinct real bugs deep
(shader portability x6, a genuine melonDS allocation bug, our own
wrong renderer-swap API call) and still blocked on a ninth
(textured geometry, cause unknown) -- the software renderer already
works reliably, and this was chasing a performance nice-to-have, not
fixing something broken. Same pattern as the JIT investigation above:
this vendored melonDS's "advanced" rendering paths don't appear to
have been exercised much in real integrations.

Everything above (all the fixes, the EGL wiring, the shader ports) is
preserved on the `opengl-renderer-wip` git branch and in
`scratch2/backups/melonds-src-opengl-attempt-<timestamp>/` (a full copy
of `third_party/melonds/src` with every fix applied -- `third_party/`
itself is gitignored, so this source tree isn't in git history at all;
the branch only has the `dscore`/`app` build-config and `ds_jni.cpp`
side of the changes). To resume: check out that branch, restore that
backed-up `src/` over `third_party/melonds/src/`, and reconfigure with
`-DENABLE_OGLRENDERER=ON` for whichever ABI needs testing.
