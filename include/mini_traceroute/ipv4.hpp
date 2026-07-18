#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

namespace mtr {

inline constexpr std::uint8_t kProtocolIcmp = 1;
inline constexpr std::uint8_t kProtocolUdp = 17;

// Minimal IPv4 header view. We define our own struct (rather than including the
// Linux <netinet/ip.h>) so the parsing logic compiles and is unit-tested on any
// platform, including Windows CI.
struct Ipv4Header {
  std::uint8_t ihl_words = 0;      // header length in 32-bit words (5..15)
  std::uint8_t protocol = 0;       // e.g. 1 = ICMP, 17 = UDP
  std::uint16_t total_length = 0;  // whole datagram length in bytes
  std::uint32_t src_addr = 0;      // host byte order
  std::uint32_t dst_addr = 0;      // host byte order

  std::size_t header_bytes() const {
    return static_cast<std::size_t>(ihl_words) * 4;
  }
};

// Parse an IPv4 header from the front of `data`. Returns nullopt when the buffer
// is too short, the version is not 4, or the declared header length is invalid.
std::optional<Ipv4Header> parse_ipv4_header(const std::uint8_t* data, std::size_t len);

// Format a host-order IPv4 address as dotted decimal (e.g. 0x01020304 -> "1.2.3.4").
std::string ipv4_to_string(std::uint32_t addr_host_order);

}  // namespace mtr
