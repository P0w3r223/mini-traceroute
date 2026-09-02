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

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. No hooks installed — run `code-review-graph update` after code changes.
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
