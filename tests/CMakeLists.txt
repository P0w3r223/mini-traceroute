# One test executable links every test translation unit against the portable core.
# It pulls in no OS networking headers, so it builds and runs on Linux and Windows alike.
add_executable(mtr_tests
  test_main.cpp
  test_checksum.cpp
  test_ipv4.cpp
  test_icmp.cpp
  test_tracer.cpp)
target_link_libraries(mtr_tests PRIVATE mtr_core)
target_include_directories(mtr_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

add_test(NAME mtr_tests COMMAND mtr_tests)
