cmake_minimum_required(VERSION 3.22)
project(gbajni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# mGBA (third_party/mgba, MPL-2.0) is prebuilt per-ABI as a static lib --
# see third_party/mgba/build-android-<abi>/, produced by configuring its
# own CMake project directly with the same NDK toolchain (its build
# system pulls in its own dependency detection/feature toggles, which
# doesn't nest cleanly via add_subdirectory the way our own gbcore does).
# Re-run that configure+build for a given ${ANDROID_ABI} if this fails to
# find a libmgba.a for it.
set(MGBA_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../third_party/mgba)
set(MGBA_BUILD_DIR ${MGBA_ROOT}/build-android-${ANDROID_ABI})

add_library(mgba STATIC IMPORTED)
set_target_properties(mgba PROPERTIES IMPORTED_LOCATION ${MGBA_BUILD_DIR}/libmgba.a)
target_include_directories(mgba INTERFACE
    ${MGBA_ROOT}/include
    ${MGBA_BUILD_DIR}/include
)

add_library(gbajni SHARED
    gba_jni.cpp
)

find_library(log-lib log)
find_library(z-lib z)

target_link_libraries(gbajni PRIVATE mgba ${log-lib} ${z-lib})
