#pragma once

#include <chrono>
#include <cstdint>
#include <functional>
#include <vector>

#include "mini_traceroute/probe.hpp"
#include "mini_traceroute/socket.hpp"

namespace mtr {

struct TraceOptions {
  int max_hops = 30;
  int probes_per_hop = 3;
  std::uint16_t base_port = 33434;
  std::chrono::milliseconds timeout{3000};
};

// Drives the traceroute algorithm over an injected ISocket. Pure orchestration:
// no sockets, no clock, no I/O of its own — all of that arrives through ISocket.
class Tracer {
 public:
  Tracer(ISocket& sock, TraceOptions opts);

  // Run the full trace. `on_hop`, if provided, is invoked once per completed hop so
  // the caller can stream output as the trace progresses.
  std::vector<HopResult> run(const std::function<void(const HopResult&)>& on_hop = {});

 private:
  ISocket& sock_;
  TraceOptions opts_;
};

}  // namespace mtr
