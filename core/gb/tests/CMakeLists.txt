add_executable(test_cpu test_cpu.cpp)
target_link_libraries(test_cpu PRIVATE gbcore)
add_test(NAME test_cpu COMMAND test_cpu)

add_executable(test_cartridge test_cartridge.cpp)
target_link_libraries(test_cartridge PRIVATE gbcore)
add_test(NAME test_cartridge COMMAND test_cartridge)

add_executable(test_system_bus test_system_bus.cpp)
target_link_libraries(test_system_bus PRIVATE gbcore)
add_test(NAME test_system_bus COMMAND test_system_bus)
