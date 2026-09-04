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
    src/joypad.cpp
)
target_include_directories(gbcore PUBLIC include)

add_executable(gen_test_rom tools/gen_test_rom.cpp)
target_link_libraries(gen_test_rom PRIVATE gbcore)

add_executable(dump_frame tools/dump_frame.cpp)
target_link_libraries(dump_frame PRIVATE gbcore)

enable_testing()
add_subdirectory(tests)
