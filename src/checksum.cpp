#include "mini_traceroute/checksum.hpp"

namespace mtr {

std::uint16_t internet_checksum(const std::uint8_t* data, std::size_t len) {
  std::uint32_t sum = 0;

  std::size_t i = 0;
  for (; i + 1 < len; i += 2) {
    sum += (static_cast<std::uint32_t>(data[i]) << 8) | data[i + 1];
  }
  if (i < len) {  // trailing odd byte is padded with a zero low byte
    sum += static_cast<std::uint32_t>(data[i]) << 8;
  }

  // Fold the carries back into the low 16 bits, then take the one's complement.
  while (sum >> 16) {
    sum = (sum & 0xFFFF) + (sum >> 16);
  }
  return static_cast<std::uint16_t>(~sum & 0xFFFF);
}

}  // namespace mtr
