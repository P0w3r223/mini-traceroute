#include "microtest.hpp"
#include "mini_traceroute/checksum.hpp"

using mtr::internet_checksum;

TEST_CASE("checksum of a zero word is 0xFFFF") {
  const std::uint8_t d[] = {0x00, 0x00};
  CHECK(internet_checksum(d, 2) == 0xFFFF);
}

TEST_CASE("checksum of 0xFFFF is 0x0000") {
  const std::uint8_t d[] = {0xFF, 0xFF};
  CHECK(internet_checksum(d, 2) == 0x0000);
}

TEST_CASE("checksum folds two words then complements") {
  const std::uint8_t d[] = {0x12, 0x34, 0x56, 0x78};  // 0x1234 + 0x5678 = 0x68AC
  CHECK(internet_checksum(d, 4) == 0x9753);
}

TEST_CASE("checksum pads a trailing odd byte with zero") {
  const std::uint8_t d[] = {0x12, 0x34, 0x56};  // 0x1234 + 0x5600 = 0x6834
  CHECK(internet_checksum(d, 3) == 0x97CB);
}

TEST_CASE("checksum of an empty span is 0xFFFF") {
  const std::uint8_t d[] = {0x00};
  CHECK(internet_checksum(d, 0) == 0xFFFF);
}
