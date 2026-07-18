#pragma once

#include <cstdint>
#include <vector>

#include "mini_traceroute/checksum.hpp"

namespace mtr_test {

// Build a raw IP packet exactly as a SOCK_RAW/IPPROTO_ICMP socket would deliver an
// ICMP error: an outer IPv4 header (protocol = ICMP), an ICMP header (type/code), then
// the embedded original datagram — an IPv4 header (protocol = UDP) plus the first 8
// bytes of UDP, carrying `embedded_dport` as its destination port. Header checksums are
// left zero; the parser under test does not validate them.
inline std::vector<std::uint8_t> make_icmp_error(std::uint8_t icmp_type, std::uint8_t icmp_code,
                                                 std::uint16_t embedded_dport) {
  std::vector<std::uint8_t> p;

  auto push_ipv4 = [&](std::uint8_t protocol) {
    p.push_back(0x45);  // version 4, IHL 5 (20-byte header)
    p.push_back(0x00);  // DSCP / ECN
    p.push_back(0x00);  // total length hi (unused by the parser)
    p.push_back(0x00);  // total length lo
    p.push_back(0x00);
    p.push_back(0x00);  // identification
    p.push_back(0x00);
    p.push_back(0x00);  // flags / fragment offset
    p.push_back(0x40);  // TTL
    p.push_back(protocol);
    p.push_back(0x00);
    p.push_back(0x00);  // header checksum
    p.push_back(10);    // src 10.0.0.1
    p.push_back(0);
    p.push_back(0);
    p.push_back(1);
    p.push_back(93);  // dst 93.184.216.34
    p.push_back(184);
    p.push_back(216);
    p.push_back(34);
  };

  push_ipv4(1);  // outer header: ICMP

  // ICMP header (8 bytes).
  p.push_back(icmp_type);
  p.push_back(icmp_code);
  p.push_back(0x00);
  p.push_back(0x00);  // checksum
  p.push_back(0x00);
  p.push_back(0x00);
  p.push_back(0x00);
  p.push_back(0x00);  // rest of header (unused)

  push_ipv4(17);  // embedded original header: UDP

  // Embedded UDP header (8 bytes): src port, dst port, length, checksum.
  p.push_back(0xC0);
  p.push_back(0x00);  // src port 49152
  p.push_back(static_cast<std::uint8_t>(embedded_dport >> 8));
  p.push_back(static_cast<std::uint8_t>(embedded_dport & 0xFF));
  p.push_back(0x00);
  p.push_back(0x08);  // length 8
  p.push_back(0x00);
  p.push_back(0x00);  // checksum

  // Patch the outer IP total length and a valid ICMP checksum, so a crafted packet matches the
  // wire and passes the parser's checksum verification.
  const std::uint16_t total = static_cast<std::uint16_t>(p.size());
  p[2] = static_cast<std::uint8_t>(total >> 8);
  p[3] = static_cast<std::uint8_t>(total & 0xFF);
  const std::uint16_t csum = mtr::internet_checksum(p.data() + 20, p.size() - 20);
  p[22] = static_cast<std::uint8_t>(csum >> 8);
  p[23] = static_cast<std::uint8_t>(csum & 0xFF);

  return p;
}

}  // namespace mtr_test
