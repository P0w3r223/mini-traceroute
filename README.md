# mini-traceroute

[![CI](https://github.com/P0w3r223/mini-traceroute/actions/workflows/ci.yml/badge.svg)](https://github.com/P0w3r223/mini-traceroute/actions/workflows/ci.yml)

**A traceroute written from scratch in C++ over raw sockets** — UDP probes with an
increasing IP TTL, ICMP replies parsed by hand, one line per hop.

> Portfolio proof B1. Demonstrates C++ and low-level network programming (IPv4 / ICMP / UDP
> on raw sockets, CMake, unit tests) — the link to the telecommunications side of the CV.

## How it works

Each probe is a UDP datagram sent with a small TTL. A router that decrements the TTL to zero
returns an **ICMP Time Exceeded** — revealing that hop. When a probe finally reaches the
destination, the closed port answers with **ICMP Port Unreachable**, and the trace stops.
Replies are matched to their probe by the destination port echoed back inside the ICMP
message.

```
 host                 router (each hop)                 destination
  |   UDP dport=33434+     |                                 |
  |   IP TTL=1 ----------->X   TTL reaches 0 -> dropped       |
  |   <---- ICMP Time Exceeded (type 11) ----                 |
  |   IP TTL=2 ----------->|------------>X                    |
  |   <-------- ICMP Time Exceeded (type 11) --------         |
  |   IP TTL=n ----------->|------------>|------------------->|  (port closed)
  |   <----- ICMP Destination Unreachable / Port (type 3, code 3) -----|
```

Full explanation with the wire details: [`docs/protocol.md`](docs/protocol.md).

## Build

Needs a C++17 compiler and CMake (3.16+).

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

## Usage

Receiving ICMP needs a raw socket, which requires privileges:

```bash
# Run with root:
sudo ./build/mini-traceroute example.com

# …or grant the capability once and run unprivileged afterwards:
sudo setcap cap_net_raw+ep ./build/mini-traceroute
./build/mini-traceroute example.com
```

```
mini-traceroute to example.com (93.184.216.34), 30 hops max, 3 probes per hop
 1  192.168.1.1  0.512 ms  0.480 ms  0.501 ms
 2  10.64.0.1 (gw.isp.net)  8.201 ms  8.110 ms  8.330 ms
 3  * * *
 4  93.184.216.34  21.004 ms  20.880 ms  21.130 ms
```

Options: `-m/--max-hops` (default 30), `-q/--queries` probes per hop (3),
`-w/--timeout` seconds (3), `-p/--port` base UDP port (33434), `-n` (no reverse DNS).

## Design

The code is split at its one I/O seam so the algorithm is testable without a network:

- **Portable core** — `checksum`, `ipv4`, `icmp`, `tracer`. Defines its own IPv4/ICMP wire
  structs (no OS networking headers), so it compiles on any platform. `Tracer` is a pure TTL
  loop that depends only on the `ISocket` interface.
- **POSIX I/O** — `posix_socket.cpp` implements `ISocket` with a UDP send socket (`IP_TTL`)
  and a raw ICMP receive socket. This is the only OS-specific, privilege-requiring part.
- **Tests** — inject a `FakeSocket` with scripted ICMP replies, so the whole trace (TTL
  sequencing, reply matching, RTT, aggregation) is unit-tested with no sockets and no root.

CI builds the full CLI + tests on Linux, and the portable core + tests on Windows — proof
that the core really is platform-independent.

## Limitations

Deliberately scoped as a focused proof, not a `traceroute` replacement:

- **IPv4 only.**
- **Linux / Unix is the reference platform.** A live trace needs a raw ICMP socket
  (root or `CAP_NET_RAW`). The raw-socket CLI is not built on Windows — the portable core and
  tests are, so CI still exercises the logic there.
- **UDP probe method only** (no ICMP-echo or TCP-SYN modes).

## License

MIT — see [LICENSE](LICENSE).
