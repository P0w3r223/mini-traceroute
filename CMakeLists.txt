cmake_minimum_required(VERSION 3.16)
project(mini_traceroute LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

if(MSVC)
  add_compile_options(/W4)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Portable core: parsing + trace orchestration. No OS networking headers, so it builds
# on every platform (Linux CLI, Linux CI, and Windows CI for the tests).
add_library(mtr_core
  src/checksum.cpp
  src/ipv4.cpp
  src/icmp.cpp
  src/tracer.cpp)
target_include_directories(mtr_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

# The CLI needs POSIX raw sockets, so it is Unix-only.
option(MTR_BUILD_CLI "Build the traceroute CLI (requires POSIX raw sockets)" ON)
if(MTR_BUILD_CLI AND UNIX)
  add_executable(mini-traceroute src/main.cpp src/posix_socket.cpp)
  target_link_libraries(mini-traceroute PRIVATE mtr_core)
elseif(MTR_BUILD_CLI AND NOT UNIX)
  message(STATUS "mini-traceroute CLI skipped: POSIX raw sockets unavailable here; "
                 "building the portable core and tests only.")
endif()

enable_testing()
add_subdirectory(tests)
