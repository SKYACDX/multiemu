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

find_library(log-lib log)

target_link_libraries(dsjni PRIVATE melonds_core teakra ${log-lib})
