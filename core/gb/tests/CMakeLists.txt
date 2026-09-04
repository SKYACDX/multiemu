add_executable(test_cpu test_cpu.cpp)
target_link_libraries(test_cpu PRIVATE gbcore)
add_test(NAME test_cpu COMMAND test_cpu)

add_executable(test_cartridge test_cartridge.cpp)
target_link_libraries(test_cartridge PRIVATE gbcore)
add_test(NAME test_cartridge COMMAND test_cartridge)

add_executable(test_system_bus test_system_bus.cpp)
target_link_libraries(test_system_bus PRIVATE gbcore)
add_test(NAME test_system_bus COMMAND test_system_bus)

add_executable(test_timer test_timer.cpp)
target_link_libraries(test_timer PRIVATE gbcore)
add_test(NAME test_timer COMMAND test_timer)

add_executable(test_gameboy test_gameboy.cpp)
target_link_libraries(test_gameboy PRIVATE gbcore)
add_test(NAME test_gameboy COMMAND test_gameboy)

add_executable(test_ppu test_ppu.cpp)
target_link_libraries(test_ppu PRIVATE gbcore)
add_test(NAME test_ppu COMMAND test_ppu)

add_executable(test_joypad test_joypad.cpp)
target_link_libraries(test_joypad PRIVATE gbcore)
add_test(NAME test_joypad COMMAND test_joypad)
