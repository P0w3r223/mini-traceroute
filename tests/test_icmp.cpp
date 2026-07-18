#include <vector>

#include "microtest.hpp"
#include "mini_traceroute/icmp.hpp"
#include "packet_builders.hpp"

using mtr_test::make_icmp_error;

TEST_CASE("time-exceeded is classified and the probe port is recovered") {
  const auto pkt = make_icmp_error(mtr::kIcmpTimeExceeded, 0, 33440);
  const auto r = mtr::parse_icmp_error(pkt.data(), pkt.size());
  REQUIRE(r.has_value());
  CHECK(r->kind == mtr::IcmpKind::TimeExceeded);
  CHECK(r->has_probe_port);
  CHECK(r->probe_port == 33440);
}

TEST_CASE("port-unreachable marks the destination as reached") {
  const auto pkt =
      make_icmp_error(mtr::kIcmpDestUnreachable, mtr::kIcmpPortUnreachableCode, 33500);
  const auto r = mtr::parse_icmp_error(pkt.data(), pkt.size());
  REQUIRE(r.has_value());
  CHECK(r->kind == mtr::IcmpKind::PortUnreachable);
  CHECK(r->probe_port == 33500);
}

TEST_CASE("other dest-unreachable codes are distinguished from port-unreachable") {
  const auto pkt = make_icmp_error(mtr::kIcmpDestUnreachable, 1 /* host unreachable */, 33501);
  const auto r = mtr::parse_icmp_error(pkt.data(), pkt.size());
  REQUIRE(r.has_value());
  CHECK(r->kind == mtr::IcmpKind::DestUnreachableOther);
}

TEST_CASE("echo reply is an untracked 'other' with no probe port") {
  const auto pkt = make_icmp_error(mtr::kIcmpEchoReply, 0, 0);
  const auto r = mtr::parse_icmp_error(pkt.data(), pkt.size());
  REQUIRE(r.has_value());
  CHECK(r->kind == mtr::IcmpKind::Other);
  CHECK(!r->has_probe_port);
}

TEST_CASE("a non-ICMP outer packet is declined") {
  const std::vector<std::uint8_t> p = {0x45, 0x00, 0x00, 0x14, 0, 0,  0, 0, 0x40, 17,
                                       0,    0,    1,    1,    1, 1,  2, 2, 2,    2};
  CHECK(!mtr::parse_icmp_error(p.data(), p.size()).has_value());
}

TEST_CASE("a truncated ICMP header is declined") {
  // Outer header says ICMP but only one ICMP byte follows (< the 8-byte header).
  const std::vector<std::uint8_t> p = {0x45, 0x00, 0x00, 0x14, 0, 0, 0,  0, 0x40, 1,
                                       0,    0,    1,    1,    1, 1, 2,  2, 2,    2, 11};
  CHECK(!mtr::parse_icmp_error(p.data(), p.size()).has_value());
}
