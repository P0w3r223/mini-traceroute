// POSIX raw-socket implementation of ISocket. Compiled only on Unix-like systems
// (guarded below and in CMake) — it needs the BSD sockets API and a raw ICMP socket,
// which requires root or the CAP_NET_RAW capability.
#if !defined(_WIN32)

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <array>
#include <cerrno>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>

#include "mini_traceroute/config.hpp"
#include "mini_traceroute/socket.hpp"

namespace mtr {
namespace {

class PosixSocket : public ISocket {
 public:
  explicit PosixSocket(const std::string& dest_ipv4) {
    udp_fd_ = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (udp_fd_ < 0) {
      throw std::runtime_error(std::string("udp socket: ") + std::strerror(errno));
    }

    icmp_fd_ = ::socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
    if (icmp_fd_ < 0) {
      const int err = errno;
      ::close(udp_fd_);
      throw std::runtime_error(std::string("raw ICMP socket: ") + std::strerror(err) +
                               " (run as root or grant CAP_NET_RAW)");
    }

    std::memset(&dest_, 0, sizeof(dest_));
    dest_.sin_family = AF_INET;
    if (::inet_pton(AF_INET, dest_ipv4.c_str(), &dest_.sin_addr) != 1) {
      const int err = errno;
      ::close(udp_fd_);
      ::close(icmp_fd_);
      throw std::runtime_error("invalid destination address '" + dest_ipv4 +
                               "': " + std::strerror(err));
    }
  }

  ~PosixSocket() override {
    if (udp_fd_ >= 0) ::close(udp_fd_);
    if (icmp_fd_ >= 0) ::close(icmp_fd_);
  }

  PosixSocket(const PosixSocket&) = delete;
  PosixSocket& operator=(const PosixSocket&) = delete;

  bool send_probe(int ttl, std::uint16_t dest_port) override {
    if (::setsockopt(udp_fd_, IPPROTO_IP, IP_TTL, &ttl, sizeof(ttl)) < 0) return false;
    dest_.sin_port = htons(dest_port);
    static const std::array<unsigned char, config::kProbePayload> payload{};
    const ssize_t n = ::sendto(udp_fd_, payload.data(), payload.size(), 0,
                               reinterpret_cast<sockaddr*>(&dest_), sizeof(dest_));
    return n == static_cast<ssize_t>(payload.size());
  }

  std::optional<IcmpPacket> recv(std::chrono::milliseconds timeout) override {
    timeval tv;
    tv.tv_sec = static_cast<long>(timeout.count() / 1000);
    tv.tv_usec = static_cast<long>((timeout.count() % 1000) * 1000);

    int ready;
    do {
      fd_set rfds;
      FD_ZERO(&rfds);
      FD_SET(icmp_fd_, &rfds);
      ready = ::select(icmp_fd_ + 1, &rfds, nullptr, nullptr, &tv);
    } while (ready < 0 && errno == EINTR);  // a signal interrupted the wait — keep waiting
    if (ready <= 0) return std::nullopt;    // timeout or error

    std::array<unsigned char, config::kRecvBufferSize> buf{};
    sockaddr_in from{};
    socklen_t from_len = sizeof(from);
    const ssize_t n = ::recvfrom(icmp_fd_, buf.data(), buf.size(), 0,
                                 reinterpret_cast<sockaddr*>(&from), &from_len);
    if (n <= 0) return std::nullopt;

    IcmpPacket pkt;
    char addr[INET_ADDRSTRLEN] = {};
    ::inet_ntop(AF_INET, &from.sin_addr, addr, sizeof(addr));
    pkt.source_addr = addr;
    pkt.data.assign(buf.data(), buf.data() + n);
    return pkt;
  }

  std::chrono::steady_clock::time_point now() override {
    return std::chrono::steady_clock::now();
  }

 private:
  int udp_fd_ = -1;
  int icmp_fd_ = -1;
  sockaddr_in dest_{};
};

}  // namespace

std::unique_ptr<ISocket> make_posix_socket(const std::string& dest_ipv4) {
  return std::make_unique<PosixSocket>(dest_ipv4);
}

}  // namespace mtr

#endif  // !_WIN32
