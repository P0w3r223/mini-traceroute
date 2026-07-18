#include "microtest.hpp"

// All TEST_CASE definitions across the other translation units self-register; this
// entry point just runs them and propagates the pass/fail exit code to CTest.
int main() { return microtest::run_all(); }
