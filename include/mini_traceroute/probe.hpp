#pragma once

#include <string>
#include <vector>

namespace mtr {

// Result of a single probe within a hop. A probe that never got a reply keeps
// responded=false and is rendered as "*".
struct HopProbe {
  bool responded = false;
  std::string addr;     // responding router / destination, dotted IPv4
  double rtt_ms = 0.0;  // round-trip time in milliseconds
};

// All probes sent with one TTL value.
struct HopResult {
  int ttl = 0;
  std::vector<HopProbe> probes;
  bool reached_dest = false;  // the destination answered (ICMP port-unreachable)
};

}  // namespace mtr
