# third_party/

Vendored external dependencies. Not committed to git (see `.gitignore`) --
each one is reproducible from the commands below, and committing a full
C source tree plus per-ABI prebuilt static libs would bloat the repo for
no benefit.

## mgba (GBA emulation core)

[mGBA](https://github.com/mgba-emu/mgba), MPL-2.0. gbacore links against
its `libmgba.a` instead of a from-scratch GBA core -- see
`app/android/gbacore/src/main/cpp/gba_jni.cpp` for why and how.

Clone at the pinned tag:

```bash
git clone --depth 1 --branch 0.10.5 https://github.com/mgba-emu/mgba.git third_party/mgba
```

Then, for each ABI gbacore builds for (arm64-v8a, armeabi-v7a, x86_64),
configure and build a minimal static lib (no Qt/SDL frontends, no
external codec/db dependencies -- just the emulation core; ZIP support
still works via mGBA's own bundled minizip fallback):

```bash
cmake -S third_party/mgba -B third_party/mgba/build-android-<ABI> \
  -DCMAKE_TOOLCHAIN_FILE=<NDK>/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=<ABI> -DANDROID_PLATFORM=android-24 \
  -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_LIBRETRO=OFF \
  -DUSE_FFMPEG=OFF -DUSE_SQLITE3=OFF -DUSE_DISCORD_RPC=OFF -DUSE_LUA=OFF \
  -DUSE_LIBZIP=OFF -DUSE_MINIZIP=OFF -DUSE_ELF=OFF -DUSE_LZMA=OFF -DUSE_PNG=OFF \
  -DUSE_ZLIB=ON -DUSE_DEBUGGERS=OFF \
  -DBUILD_GL=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF \
  -DBUILD_STATIC=ON -DBUILD_SHARED=OFF

cmake --build third_party/mgba/build-android-<ABI>
```

`app/android/gbacore/src/main/cpp/CMakeLists.txt` expects
`third_party/mgba/build-android-${ANDROID_ABI}/libmgba.a` to exist for
each ABI in `gbacore/build.gradle`'s `abiFilters` -- run the above for
all three before building the app, or the gbacore native build will
fail to find the import library.
