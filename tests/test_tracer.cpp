#include <chrono>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "microtest.hpp"
#include "mini_traceroute/icmp.hpp"
#include "mini_traceroute/tracer.hpp"
#include "packet_builders.hpp"

using namespace mtr;

namespace {

// A scripted reply, keyed in the fake socket by the probe's destination port.
struct Scripted {
  bool timeout = true;
  std::string src;
  std::vector<std::uint8_t> data;
};

Scripted reply(std::uint8_t type, std::uint8_t code, std::uint16_t dport, std::string src) {
  Scripted s;
  s.timeout = false;
  s.src = std::move(src);
  s.data = mtr_test::make_icmp_error(type, code, dport);
  return s;
}

// Fake ISocket: no network. Records what was sent, and delivers each scripted reply
// at most once (then reports silence), with a monotonic clock that ticks per call so
// round-trip times are positive and deterministic.
class FakeSocket : public ISocket {
 public:
  std::map<std::uint16_t, Scripted> responses;
  std::vector<int> sent_ttls;
  std::vector<std::uint16_t> sent_ports;
  bool send_ok = true;

  bool send_probe(int ttl, std::uint16_t dport) override {
    sent_ttls.push_back(ttl);
    sent_ports.push_back(dport);
    last_dport_ = dport;
    return send_ok;
  }

  std::optional<IcmpPacket> recv(std::chrono::milliseconds) override {
    if (delivered_.count(last_dport_)) return std::nullopt;
    const auto it = responses.find(last_dport_);
    if (it == responses.end() || it->second.timeout) return std::nullopt;
    delivered_.insert(last_dport_);
    IcmpPacket p;
    p.source_addr = it->second.src;
    p.data = it->second.data;
    return p;
  }

  std::chrono::steady_clock::time_point now() override {
    const auto t = clock_;
    clock_ += std::chrono::milliseconds(1);
    return t;
  }

 private:
  std::uint16_t last_dport_ = 0;
  std::set<std::uint16_t> delivered_;
  std::chrono::steady_clock::time_point clock_{};
};

}  // namespace

TEST_CASE("trace stops when the destination replies port-unreachable") {
  FakeSocket sock;
  sock.responses[33434] = reply(kIcmpTimeExceeded, 0, 33434, "10.0.0.1");
  sock.responses[33435] = reply(kIcmpTimeExceeded, 0, 33435, "10.0.0.2");
  sock.responses[33436] =
      reply(kIcmpDestUnreachable, kIcmpPortUnreachableCode, 33436, "93.184.216.34");

  TraceOptions opts;
  opts.probes_per_hop = 1;
  opts.max_hops = 10;
  Tracer tracer(sock, opts);
  const auto hops = tracer.run();

  REQUIRE(hops.size() == 3);
  CHECK(hops[0].ttl == 1);
  CHECK(hops[0].probes.at(0).responded);
  CHECK(hops[0].probes.at(0).addr == "10.0.0.1");
  CHECK(hops[0].probes.at(0).rtt_ms > 0.0);
  CHECK(hops[2].reached_dest);
  CHECK(hops[2].probes.at(0).addr == "93.184.216.34");
  CHECK(sock.sent_ttls == std::vector<int>({1, 2, 3}));
  CHECK(sock.sent_ports == std::vector<std::uint16_t>({33434, 33435, 33436}));
}

TEST_CASE("unanswered probes are recorded as non-responses") {
  FakeSocket sock;
  // TTL 1: ports 33434..33436 stay silent. TTL 2: destination answers on 33437.
  sock.responses[33437] =
      reply(kIcmpDestUnreachable, kIcmpPortUnreachableCode, 33437, "93.184.216.34");

  TraceOptions opts;
  opts.probes_per_hop = 3;
  opts.max_hops = 10;
  Tracer tracer(sock, opts);
  const auto hops = tracer.run();

  REQUIRE(hops.size() == 2);
  CHECK(hops[0].probes.size() == 3);
  for (const auto& pr : hops[0].probes) CHECK(!pr.responded);
  CHECK(hops[1].reached_dest);
}

TEST_CASE("a reply carrying a different probe port is ignored") {
  FakeSocket sock;
  // The only packet available for port 33434 embeds a different probe port (33999),
  // so the tracer must not attribute it to this probe.
  sock.responses[33434] = reply(kIcmpTimeExceeded, 0, 33999, "10.9.9.9");

  TraceOptions opts;
  opts.probes_per_hop = 1;
  opts.max_hops = 1;
  Tracer tracer(sock, opts);
  const auto hops = tracer.run();

  REQUIRE(hops.size() == 1);
  CHECK(!hops[0].probes.at(0).responded);
}

TEST_CASE("send failures run the trace to the hop limit without replies") {
  FakeSocket sock;
  sock.send_ok = false;

  TraceOptions opts;
  opts.probes_per_hop = 2;
  opts.max_hops = 4;
  Tracer tracer(sock, opts);
  const auto hops = tracer.run();

  REQUIRE(hops.size() == 4);
  for (const auto& h : hops)
    for (const auto& pr : h.probes) CHECK(!pr.responded);
}
