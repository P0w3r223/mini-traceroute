#include "mini_traceroute/tracer.hpp"

#include "mini_traceroute/icmp.hpp"

namespace mtr {

namespace {
double to_ms(std::chrono::steady_clock::duration d) {
  return std::chrono::duration<double, std::milli>(d).count();
}
}  // namespace

Tracer::Tracer(ISocket& sock, TraceOptions opts) : sock_(sock), opts_(opts) {}

std::vector<HopResult> Tracer::run(const std::function<void(const HopResult&)>& on_hop) {
  std::vector<HopResult> hops;
  std::uint16_t port = opts_.base_port;

  for (int ttl = 1; ttl <= opts_.max_hops; ++ttl) {
    HopResult hop;
    hop.ttl = ttl;

    for (int p = 0; p < opts_.probes_per_hop; ++p) {
      const std::uint16_t dport = port++;
      HopProbe probe;

      const auto sent_at = sock_.now();
      if (!sock_.send_probe(ttl, dport)) {
        hop.probes.push_back(probe);  // send failed → counts as no reply ("*")
        continue;
      }

      // Wait for the reply to *this* probe, identified by its destination port.
      // Replies for other probes (or unparseable packets) are skipped, not counted.
      const auto deadline = sent_at + opts_.timeout;
      for (;;) {
        const auto remaining = deadline - sock_.now();
        if (remaining <= std::chrono::steady_clock::duration::zero()) break;

        auto pkt = sock_.recv(std::chrono::duration_cast<std::chrono::milliseconds>(remaining));
        if (!pkt) break;  // timed out

        const auto parsed = parse_icmp_error(pkt->data.data(), pkt->data.size());
        if (!parsed) continue;
        // Require a recovered destination port that matches this probe. A reply whose embedded
        // port can't be read (truncated quote) is not ours — never attribute it (H1).
        if (!parsed->has_probe_port || parsed->probe_port != dport) continue;

        probe.responded = true;
        probe.addr = pkt->source_addr;
        probe.rtt_ms = to_ms(sock_.now() - sent_at);
        if (parsed->kind == IcmpKind::PortUnreachable) hop.reached_dest = true;
        break;
      }

      hop.probes.push_back(probe);
    }

    if (on_hop) on_hop(hop);
    hops.push_back(hop);
    if (hop.reached_dest) break;
  }

  return hops;
}

}  // namespace mtr
