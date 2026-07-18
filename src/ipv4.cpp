#include "mini_traceroute/ipv4.hpp"

#include <string>

namespace mtr {

std::optional<Ipv4Header> parse_ipv4_header(const std::uint8_t* data, std::size_t len) {
  if (data == nullptr || len < 20) return std::nullopt;

  const std::uint8_t version = static_cast<std::uint8_t>(data[0] >> 4);
  const std::uint8_t ihl = static_cast<std::uint8_t>(data[0] & 0x0F);
  if (version != 4 || ihl < 5) return std::nullopt;

  const std::size_t header_bytes = static_cast<std::size_t>(ihl) * 4;
  if (header_bytes > len) return std::nullopt;

  Ipv4Header h;
  h.ihl_words = ihl;
  h.total_length = static_cast<std::uint16_t>((data[2] << 8) | data[3]);
  h.protocol = data[9];
  h.src_addr = (static_cast<std::uint32_t>(data[12]) << 24) |
               (static_cast<std::uint32_t>(data[13]) << 16) |
               (static_cast<std::uint32_t>(data[14]) << 8) |
               static_cast<std::uint32_t>(data[15]);
  h.dst_addr = (static_cast<std::uint32_t>(data[16]) << 24) |
               (static_cast<std::uint32_t>(data[17]) << 16) |
               (static_cast<std::uint32_t>(data[18]) << 8) |
               static_cast<std::uint32_t>(data[19]);
  return h;
}

std::string ipv4_to_string(std::uint32_t addr_host_order) {
  return std::to_string((addr_host_order >> 24) & 0xFF) + "." +
         std::to_string((addr_host_order >> 16) & 0xFF) + "." +
         std::to_string((addr_host_order >> 8) & 0xFF) + "." +
         std::to_string(addr_host_order & 0xFF);
}

}  // namespace mtr
