add_executable(test_cpu test_cpu.cpp)
target_link_libraries(test_cpu PRIVATE gbcore)
add_test(NAME test_cpu COMMAND test_cpu)
