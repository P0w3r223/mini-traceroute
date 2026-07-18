#include "mini_traceroute/icmp.hpp"

#include "mini_traceroute/checksum.hpp"
#include "mini_traceroute/ipv4.hpp"

namespace mtr {

std::optional<IcmpResponse> parse_icmp_error(const std::uint8_t* packet, std::size_t len) {
  const auto outer = parse_ipv4_header(packet, len);
  if (!outer || outer->protocol != kProtocolIcmp) return std::nullopt;

  const std::size_t icmp_off = outer->header_bytes();
  if (icmp_off + 8 > len) return std::nullopt;  // need at least the 8-byte ICMP header

  // Verify the ICMP checksum before trusting the reply. Bound the message by the IP total
  // length when it is sane (authoritative — a raw socket may hand us trailing bytes); a valid
  // ICMP message sums to zero under the internet checksum.
  std::size_t icmp_len = len - icmp_off;
  const std::size_t declared =
      outer->total_length >= outer->header_bytes() ? outer->total_length - outer->header_bytes() : 0;
  if (declared > 0 && declared <= icmp_len) icmp_len = declared;
  if (internet_checksum(packet + icmp_off, icmp_len) != 0) return std::nullopt;

  const std::uint8_t type = packet[icmp_off];
  const std::uint8_t code = packet[icmp_off + 1];

  IcmpResponse resp;
  if (type == kIcmpTimeExceeded) {
    resp.kind = IcmpKind::TimeExceeded;
  } else if (type == kIcmpDestUnreachable) {
    resp.kind = (code == kIcmpPortUnreachableCode) ? IcmpKind::PortUnreachable
                                                   : IcmpKind::DestUnreachableOther;
  } else {
    // Any other ICMP message (echo request/reply, redirect, ...) is not a hop signal and has
    // no probe to match — decline it so it can never be attributed to a probe.
    return std::nullopt;
  }

  // A time-exceeded / unreachable message echoes back the datagram that triggered it:
  // the original IPv4 header followed by its first 8 bytes (the whole UDP header). The
  // destination port there is how we tie the reply to the exact probe we sent.
  const std::size_t inner_off = icmp_off + 8;
  const auto inner = parse_ipv4_header(packet + inner_off, len - inner_off);
  if (inner && inner->protocol == kProtocolUdp) {
    const std::size_t udp_off = inner_off + inner->header_bytes();
    if (udp_off + 4 <= len) {
      resp.probe_port =
          static_cast<std::uint16_t>((packet[udp_off + 2] << 8) | packet[udp_off + 3]);
      resp.has_probe_port = true;
    }
  }
  return resp;
}

}  // namespace mtr
