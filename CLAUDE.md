# CLAUDE.md — mini-traceroute

Guidance for Claude Code (and any contributor) working in this repository.

## What this project is
A small traceroute implemented from scratch in C++ over raw sockets: it sends UDP probes
with an increasing IP TTL and reads the ICMP replies to reconstruct the path to a host.
Portfolio proof B1 — evidence of C++ and low-level network programming (IPv4/ICMP/UDP),
the link to the telecommunications side of the CV.

## Architecture
```
include/mini_traceroute/
  config.hpp    # default probe parameters (base port, hops, timeout) — no I/O
  checksum.hpp  # internet checksum (RFC 1071)
  ipv4.hpp      # own IPv4 header struct + parser (portable, no <netinet/ip.h>)
  icmp.hpp      # ICMP classification + probe-port recovery from the embedded datagram
  probe.hpp     # HopProbe / HopResult data types
  socket.hpp    # ISocket abstraction (+ POSIX factory) — the only I/O seam
  tracer.hpp    # Tracer: pure TTL loop, depends only on ISocket
src/
  *.cpp         # implementations; posix_socket.cpp + main.cpp are the POSIX-only parts
tests/          # microtest harness + FakeSocket; portable, builds on any platform
docs/
  protocol.md   # the UDP + ICMP method, written out
  index.html    # GitHub Pages entry point — the interactive visualiser
  assets/       # checksum/ipv4/icmp/packet = JS ports of the core; simulation = Tracer::run;
                # app.js is the only file that touches the DOM
```

The **portable core** (parsing + `Tracer`) uses only its own header structs, so it compiles
and is unit-tested everywhere — including Windows CI. The **raw-socket I/O** lives behind
`ISocket` in `posix_socket.cpp` (Linux/Unix only); tests inject a `FakeSocket`, so no
privileges or real network are needed to verify the algorithm.

## Rules (do not violate)
- **Separate I/O from logic.** All sockets/clock go through `ISocket`. The `Tracer` and the
  parsers stay pure and testable — never call `socket()`/`recv()` from the core.
- **Portable core stays portable.** Do not include `<netinet/...>` or other OS networking
  headers in `checksum/ipv4/icmp/tracer`; define the wire structs ourselves.
- **Raw ICMP needs privileges.** The CLI must fail with a clear message when the raw socket
  cannot be opened (root / `CAP_NET_RAW`), never crash.
- **Match replies to probes by destination port.** Each probe uses a distinct UDP dest port;
  never attribute an ICMP reply whose embedded port differs.
- **IPv4 only.** Documented scope — do not silently half-implement IPv6.
- **The site mirrors the core, it does not reinvent it.** `docs/assets/{checksum,ipv4,icmp}.js`
  are ports of the matching `src/*.cpp`; when one side changes, change the other. The page must
  keep saying plainly that its network is simulated — never let it read like a live trace.

## Conventions
- English for code, comments, README, commits. Conventional Commits.
- No hardcoded values — tunables live in `config.hpp`; the CLI may override via flags.
- Separate I/O from logic; pure functions are unit-tested.
- C++17, warnings on (`-Wall -Wextra -Wpedantic` / `/W4`). No external test dependency.

## How to build and run
```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure

# Live trace (Linux) — needs privileges for the raw ICMP socket:
sudo ./build/mini-traceroute example.com
# or grant the capability once, then run unprivileged:
sudo setcap cap_net_raw+ep ./build/mini-traceroute && ./build/mini-traceroute example.com
```
On Windows, build with `-DMTR_BUILD_CLI=OFF` to compile the portable core and tests only
(the raw-socket CLI is POSIX).

## The published page

`docs/index.html` is one of twelve surfaces held to a single specification: ten house colour tokens
with pinned per-theme values, a dark override, six card-metadata tags, a profile back-link, a
result-shaped `h1`, and — since S4 — the rule that **every figure the surface prints is a figure
a committed artifact prints**, never a rounding and never a re-derivation. The spec is
`docs/audit/0007_divergence-and-the-page-spec.md` §5 in the private portfolio index, and
`tools/pagespec` there sweeps all twelve from the submodule working trees on every push.

That checker is the **only** carrier here. This repository is C++/CMake with no `pyproject.toml`,
so there is nowhere to host a Python assertion — a structural exemption rather than an omission,
recorded as such in `docs/adr/0004_what-carries-the-page-spec.md` §6. It is the one surface of
twelve in that position, so a page change here is checked from the index or not at all.

## Code intelligence

Two indexes exist over this repo, and which one is reachable depends on where the session started:

- `.codegraph/` — the `codegraph_explore` MCP tool, or `codegraph explore "<question>"` from a
  shell. Returns the relevant symbols' verbatim source plus the call paths between them, so it
  usually answers a "how does X work" or "what calls Y" question in one call. The CLI ships as
  `codegraph.cmd`, so from Git Bash it needs the extension — bare `codegraph` resolves only
  where PATHEXT applies.
- `.code-review-graph/` — its MCP server is declared in **this repository's** `.mcp.json`, so it
  loads when Claude Code runs with this directory as the working directory, and is simply absent
  when the session started in the private portfolio index one level up. When its tools are
  missing the CLI still works: `uvx code-review-graph <command>`.

**Neither index has a hook**, so both are only as fresh as the last manual update — and a graph
that predates the work you are looking at will answer confidently about code that is gone.
`codegraph.cmd status` reports the index's age; `codegraph.cmd sync` brings it forward, and
`uvx code-review-graph update` does the same for the other. Check before trusting either on a
question about recent changes.

Grep, Glob and Read stay correct whenever the question is about text rather than structure, or
when neither index is available.
