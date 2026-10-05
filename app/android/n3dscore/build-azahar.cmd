@echo off
rem Configures and builds Azahar's libretro core for Android arm64 (GLES),
rem the 3DS core this module loads. Kept outside Gradle like melonDS: it
rem takes a long time to build and its CMake needs 3.25+, newer than the
rem SDK's 3.22 (Visual Studio's bundled CMake is used instead).
rem
rem Source: third_party/azahar (gitignored), tag 2126.1.2 with submodules,
rem with patches/azahar/*.patch applied:
rem   git clone --depth 1 --branch 2126.1.2 --recurse-submodules --shallow-submodules https://github.com/azahar-emu/azahar.git third_party/azahar
rem   git -C third_party/azahar apply ../../patches/azahar/*.patch
rem
rem   build-azahar.cmd configure   (once)
rem   build-azahar.cmd             (build + copy into android-jniLibs)
set VSCMAKE=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake
set PATH=%VSCMAKE%\CMake\bin;%VSCMAKE%\Ninja;%PATH%
set NDK=D:\Android\ndk\29.0.14206865
set SRC=%~dp0..\..\..\third_party\azahar
set OUT=%SRC%\build-android-arm64-v8a

if "%1"=="configure" (
  cmake -S "%SRC%" -B "%OUT%" -G Ninja ^
    -DCMAKE_TOOLCHAIN_FILE=%NDK%\build\cmake\android.toolchain.cmake ^
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DENABLE_LIBRETRO=ON -DENABLE_VULKAN=OFF -DENABLE_TESTS=OFF ^
    -DENABLE_LTO=OFF -DCITRA_WARNINGS_AS_ERRORS=OFF -DCITRA_USE_PRECOMPILED_HEADERS=OFF
  exit /b %ERRORLEVEL%
)
cmake --build "%OUT%" --target citra_libretro -j 6 || exit /b 1
rem Renamed lib*.so for this module to package (its jniLibs dir).
if not exist "%SRC%\android-jniLibs\arm64-v8a" mkdir "%SRC%\android-jniLibs\arm64-v8a"
copy /y "%OUT%\bin\Release\azahar_libretro.so" "%SRC%\android-jniLibs\arm64-v8a\libazahar_libretro.so"
