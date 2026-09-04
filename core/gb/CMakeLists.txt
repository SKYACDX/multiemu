cmake_minimum_required(VERSION 3.16)
project(gbcore CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(gbcore STATIC
    src/cpu.cpp
    src/cartridge.cpp
    src/system_bus.cpp
    src/timer.cpp
    src/ppu.cpp
)
target_include_directories(gbcore PUBLIC include)

enable_testing()
add_subdirectory(tests)
