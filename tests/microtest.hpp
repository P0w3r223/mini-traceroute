#pragma once

// A tiny self-contained test harness (~70 lines). Deliberately not an external
// dependency: the whole project then builds offline with just a C++17 compiler and
// CMake. Provides TEST_CASE / CHECK / REQUIRE and a runner that returns a non-zero
// exit code on any failure, so CTest reports pass/fail correctly.

#include <cstdio>
#include <exception>
#include <functional>
#include <string>
#include <vector>

namespace microtest {

struct TestCase {
  std::string name;
  std::function<void()> fn;
};

inline std::vector<TestCase>& registry() {
  static std::vector<TestCase> r;
  return r;
}
inline int& failures() {
  static int f = 0;
  return f;
}
inline int& checks() {
  static int c = 0;
  return c;
}

struct Registrar {
  Registrar(std::string name, std::function<void()> fn) {
    registry().push_back({std::move(name), std::move(fn)});
  }
};

inline void report_failure(const char* file, int line, const char* expr) {
  ++failures();
  std::printf("  FAILED  %s:%d  (%s)\n", file, line, expr);
}

inline int run_all() {
  int passed = 0;
  for (const auto& tc : registry()) {
    const int before = failures();
    try {
      tc.fn();
    } catch (const std::exception& e) {
      ++failures();
      std::printf("  THREW   %s: %s\n", tc.name.c_str(), e.what());
    } catch (...) {
      ++failures();
      std::printf("  THREW   %s: unknown exception\n", tc.name.c_str());
    }
    if (failures() == before) {
      ++passed;
    } else {
      std::printf("[ FAIL ] %s\n", tc.name.c_str());
    }
  }
  std::printf("\n%d/%zu test cases passed, %d checks, %d failure(s)\n", passed,
              registry().size(), checks(), failures());
  return failures() == 0 ? 0 : 1;
}

}  // namespace microtest

#define MT_CONCAT_(a, b) a##b
#define MT_CONCAT(a, b) MT_CONCAT_(a, b)

#define TEST_CASE(name)                                                         \
  static void MT_CONCAT(mt_test_, __LINE__)();                                  \
  static microtest::Registrar MT_CONCAT(mt_reg_, __LINE__)(                     \
      name, &MT_CONCAT(mt_test_, __LINE__));                                    \
  static void MT_CONCAT(mt_test_, __LINE__)()

#define CHECK(expr)                                                            \
  do {                                                                         \
    ++microtest::checks();                                                     \
    if (!(expr)) microtest::report_failure(__FILE__, __LINE__, #expr);         \
  } while (0)

// Like CHECK but aborts the current test case (use when continuing would crash).
#define REQUIRE(expr)                                                          \
  do {                                                                         \
    ++microtest::checks();                                                     \
    if (!(expr)) {                                                             \
      microtest::report_failure(__FILE__, __LINE__, #expr);                    \
      return;                                                                  \
    }                                                                          \
  } while (0)
