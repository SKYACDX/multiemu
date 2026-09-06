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

## What's not done yet

No NDS instance is actually constructed or ROM loaded yet
(`ds_jni.cpp` only exposes a version-probe function so far). The next
piece is a BIOS/firmware strategy: melonDS supports a built-in
"FreeBIOS" fallback (an open-source reimplementation, no real Nintendo
BIOS/firmware dump required) that many commercial ROMs boot fine under
-- that's the path to take here rather than asking the user to supply
copyrighted BIOS files, and is the natural next step before writing the
actual `nativeCreate`/`loadROM`/`runFrame` JNI functions, the dual-
screen Kotlin view, and touch-screen input mapping.
