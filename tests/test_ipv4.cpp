#include "microtest.hpp"
#include "mini_traceroute/ipv4.hpp"

TEST_CASE("parse a well-formed IPv4 header") {
  const std::uint8_t h[] = {0x45, 0x00, 0x00, 0x1C, 0x00, 0x00, 0x00,
                            0x00, 0x40, 0x11, 0x00, 0x00, 1,    2,
                            3,    4,    5,    6,    7,    8};
  const auto r = mtr::parse_ipv4_header(h, sizeof(h));
  REQUIRE(r.has_value());
  CHECK(r->ihl_words == 5);
  CHECK(r->header_bytes() == 20);
  CHECK(r->protocol == mtr::kProtocolUdp);
  CHECK(r->total_length == 28);
  CHECK(mtr::ipv4_to_string(r->src_addr) == "1.2.3.4");
  CHECK(mtr::ipv4_to_string(r->dst_addr) == "5.6.7.8");
}

TEST_CASE("reject a truncated IPv4 header") {
  const std::uint8_t h[] = {0x45, 0x00, 0x00};
  CHECK(!mtr::parse_ipv4_header(h, sizeof(h)).has_value());
}

TEST_CASE("reject a non-IPv4 version") {
  std::uint8_t h[20] = {};
  h[0] = 0x65;  // version 6, IHL 5
  CHECK(!mtr::parse_ipv4_header(h, sizeof(h)).has_value());
}

TEST_CASE("reject an IHL below the 5-word minimum") {
  std::uint8_t h[20] = {};
  h[0] = 0x44;  // version 4, IHL 4
  CHECK(!mtr::parse_ipv4_header(h, sizeof(h)).has_value());
}

TEST_CASE("reject an IHL that overruns the buffer") {
  std::uint8_t h[20] = {};
  h[0] = 0x4F;  // version 4, IHL 15 -> declares a 60-byte header in a 20-byte buffer
  CHECK(!mtr::parse_ipv4_header(h, sizeof(h)).has_value());
}

TEST_CASE("ipv4_to_string formats all four octets") {
  CHECK(mtr::ipv4_to_string(0x0A0B0C0Du) == "10.11.12.13");
  CHECK(mtr::ipv4_to_string(0xFFFFFFFFu) == "255.255.255.255");
}
