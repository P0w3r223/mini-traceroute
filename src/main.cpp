// Command-line front end for the traceroute engine. POSIX only: it resolves the
// target, opens the raw-socket backend, and streams one line per hop.
#if !defined(_WIN32)

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>

#include "mini_traceroute/config.hpp"
#include "mini_traceroute/socket.hpp"
#include "mini_traceroute/tracer.hpp"

namespace {

struct Args {
  std::string host;
  mtr::TraceOptions opts;
  bool numeric = false;  // -n: skip reverse DNS
};

void print_usage(const char* prog) {
  std::fprintf(stderr,
               "Usage: %s [options] <host>\n"
               "  -m, --max-hops N   maximum TTL / number of hops (default %d)\n"
               "  -q, --queries N    probes per hop (default %d)\n"
               "  -w, --timeout SEC  per-probe timeout in seconds (default %.0f)\n"
               "  -p, --port PORT    base UDP destination port (default %u)\n"
               "  -n                 do not resolve hop addresses to hostnames\n"
               "  -h, --help         show this help\n",
               prog, mtr::config::kMaxHops, mtr::config::kProbesPerHop,
               static_cast<double>(mtr::config::kProbeTimeout.count()) / 1000.0,
               static_cast<unsigned>(mtr::config::kBasePort));
}

// Returns true on success. On failure prints a message and sets exit_code.
bool parse_args(int argc, char** argv, Args& out, int& exit_code) {
  auto need_value = [&](int& i, const char* flag) -> const char* {
    if (i + 1 >= argc) {
      std::fprintf(stderr, "error: %s requires a value\n", flag);
      exit_code = 2;
      return nullptr;
    }
    return argv[++i];
  };

  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "-h" || a == "--help") {
      print_usage(argv[0]);
      exit_code = 0;
      return false;
    } else if (a == "-n") {
      out.numeric = true;
    } else if (a == "-m" || a == "--max-hops") {
      const char* v = need_value(i, "--max-hops");
      if (!v) return false;
      out.opts.max_hops = std::atoi(v);
    } else if (a == "-q" || a == "--queries") {
      const char* v = need_value(i, "--queries");
      if (!v) return false;
      out.opts.probes_per_hop = std::atoi(v);
    } else if (a == "-w" || a == "--timeout") {
      const char* v = need_value(i, "--timeout");
      if (!v) return false;
      out.opts.timeout = std::chrono::milliseconds(static_cast<long long>(std::atof(v) * 1000));
    } else if (a == "-p" || a == "--port") {
      const char* v = need_value(i, "--port");
      if (!v) return false;
      out.opts.base_port = static_cast<std::uint16_t>(std::atoi(v));
    } else if (!a.empty() && a[0] == '-') {
      std::fprintf(stderr, "error: unknown option '%s'\n", a.c_str());
      exit_code = 2;
      return false;
    } else {
      if (!out.host.empty()) {
        std::fprintf(stderr, "error: only one host may be given\n");
        exit_code = 2;
        return false;
      }
      out.host = a;
    }
  }

  if (out.host.empty()) {
    print_usage(argv[0]);
    exit_code = 2;
    return false;
  }
  if (out.opts.max_hops < 1 || out.opts.probes_per_hop < 1 ||
      out.opts.timeout <= std::chrono::milliseconds::zero()) {
    std::fprintf(stderr, "error: max-hops, queries and timeout must be positive\n");
    exit_code = 2;
    return false;
  }
  return true;
}

// Resolve a hostname to a single IPv4 dotted address. Returns empty on failure.
std::string resolve_ipv4(const std::string& host) {
  addrinfo hints{};
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_DGRAM;

  addrinfo* res = nullptr;
  if (::getaddrinfo(host.c_str(), nullptr, &hints, &res) != 0 || res == nullptr) return {};

  char buf[INET_ADDRSTRLEN] = {};
  auto* sin = reinterpret_cast<sockaddr_in*>(res->ai_addr);
  ::inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf));
  ::freeaddrinfo(res);
  return buf;
}

// Reverse lookup a dotted IPv4 address; empty string if none.
std::string reverse_lookup(const std::string& addr) {
  sockaddr_in sa{};
  sa.sin_family = AF_INET;
  if (::inet_pton(AF_INET, addr.c_str(), &sa.sin_addr) != 1) return {};

  char host[NI_MAXHOST] = {};
  if (::getnameinfo(reinterpret_cast<sockaddr*>(&sa), sizeof(sa), host, sizeof(host), nullptr, 0,
                    NI_NAMEREQD) != 0) {
    return {};
  }
  return host;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  int exit_code = 0;
  if (!parse_args(argc, argv, args, exit_code)) return exit_code;

  const std::string dest_ip = resolve_ipv4(args.host);
  if (dest_ip.empty()) {
    std::fprintf(stderr, "error: cannot resolve '%s' to an IPv4 address\n", args.host.c_str());
    return 1;
  }

  std::unique_ptr<mtr::ISocket> sock;
  try {
    sock = mtr::make_posix_socket(dest_ip);
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }

  std::printf("mini-traceroute to %s (%s), %d hops max, %d probes per hop\n", args.host.c_str(),
              dest_ip.c_str(), args.opts.max_hops, args.opts.probes_per_hop);

  std::map<std::string, std::string> ptr_cache;  // addr -> hostname ("" = looked up, none)

  auto on_hop = [&](const mtr::HopResult& hop) {
    std::printf("%2d ", hop.ttl);
    std::string last_addr;
    for (const auto& probe : hop.probes) {
      if (!probe.responded) {
        std::printf(" *");
        continue;
      }
      if (probe.addr != last_addr) {
        last_addr = probe.addr;
        if (args.numeric) {
          std::printf("  %s", probe.addr.c_str());
        } else {
          auto it = ptr_cache.find(probe.addr);
          if (it == ptr_cache.end()) it = ptr_cache.emplace(probe.addr, reverse_lookup(probe.addr)).first;
          if (it->second.empty()) {
            std::printf("  %s", probe.addr.c_str());
          } else {
            std::printf("  %s (%s)", it->second.c_str(), probe.addr.c_str());
          }
        }
      }
      std::printf("  %.3f ms", probe.rtt_ms);
    }
    std::printf("\n");
  };

  mtr::Tracer tracer(*sock, args.opts);
  tracer.run(on_hop);
  return 0;
}

#else  // _WIN32

#include <cstdio>
int main() {
  std::fprintf(stderr,
               "mini-traceroute requires POSIX raw sockets and does not run on Windows.\n"
               "Build and run it on Linux (see README).\n");
  return 1;
}

#endif  // !_WIN32
