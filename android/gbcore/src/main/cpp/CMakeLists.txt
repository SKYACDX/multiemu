cmake_minimum_required(VERSION 3.22)
project(gbjni CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pull in the platform-independent emulator core as-is; nothing about it
# is Android-specific, which is the whole point of keeping it separate.
set(GBCORE_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../core/gb)
add_subdirectory(${GBCORE_ROOT} ${CMAKE_BINARY_DIR}/gbcore)

add_library(gbjni SHARED
    gameboy_jni.cpp
)

find_library(log-lib log)

target_link_libraries(gbjni PRIVATE gbcore ${log-lib})
