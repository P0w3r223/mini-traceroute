#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mtr {

// A raw ICMP packet received from the network, plus the address that sent it.
struct IcmpPacket {
  std::string source_addr;         // dotted IPv4 of the sender (from recvfrom)
  std::vector<std::uint8_t> data;  // full received bytes (outer IPv4 header + ICMP)
};

// Abstraction over the raw-socket I/O. Keeping the trace logic behind this interface
// means the whole algorithm (TTL loop, reply matching, RTT, aggregation) is unit-tested
// with a fake socket — no privileges, no real network, portable to any platform.
class ISocket {
 public:
  virtual ~ISocket() = default;

  // Send one UDP probe toward the destination with the given IP TTL and destination
  // port. Returns false if the datagram could not be sent.
  virtual bool send_probe(int ttl, std::uint16_t dest_port) = 0;

  // Block up to `timeout` for one ICMP packet. Returns nullopt on timeout / no data.
  virtual std::optional<IcmpPacket> recv(std::chrono::milliseconds timeout) = 0;

  // Monotonic clock, injected so tests get deterministic round-trip times.
  virtual std::chrono::steady_clock::time_point now() = 0;
};

}  // namespace mtr

#if !defined(_WIN32)
#include <memory>
namespace mtr {
// Factory for the POSIX raw-socket implementation (Linux/Unix only). Throws
// std::runtime_error if the raw ICMP socket cannot be opened (needs root/CAP_NET_RAW).
std::unique_ptr<ISocket> make_posix_socket(const std::string& dest_ipv4);
}  // namespace mtr
#endif
