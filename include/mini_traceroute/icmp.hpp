#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>

namespace mtr {

inline constexpr std::uint8_t kIcmpEchoReply = 0;
inline constexpr std::uint8_t kIcmpDestUnreachable = 3;
inline constexpr std::uint8_t kIcmpEchoRequest = 8;
inline constexpr std::uint8_t kIcmpTimeExceeded = 11;
inline constexpr std::uint8_t kIcmpPortUnreachableCode = 3;

// What an intermediate router or the destination told us about a probe.
enum class IcmpKind {
  TimeExceeded,          // type 11 — a router decremented TTL to zero (an intermediate hop)
  PortUnreachable,       // type 3 / code 3 — the destination was reached (port closed, as expected)
  DestUnreachableOther,  // type 3, any other code — network/host/protocol unreachable
  Other,                 // any other ICMP message (ignored by the tracer)
};

struct IcmpResponse {
  IcmpKind kind = IcmpKind::Other;
  std::uint16_t probe_port = 0;  // destination port of the embedded UDP probe (for matching)
  bool has_probe_port = false;   // false when the port could not be recovered
};

// Parse a raw IP packet as delivered by a SOCK_RAW/IPPROTO_ICMP socket: an outer IPv4
// header, an ICMP header, and — for errors — the embedded original datagram (IPv4 +
// first 8 bytes of UDP), from which we recover the probe's destination port so the
// reply can be matched to the probe that caused it. Returns nullopt when the buffer
// is not a parseable ICMP-over-IPv4 packet.
std::optional<IcmpResponse> parse_icmp_error(const std::uint8_t* packet, std::size_t len);

}  // namespace mtr
