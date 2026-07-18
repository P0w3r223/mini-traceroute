#pragma once

#include <cstddef>
#include <cstdint>

namespace mtr {

// Internet checksum (RFC 1071): one's-complement sum of 16-bit words, folded.
// Portable — operates on a raw byte span, no networking headers required.
std::uint16_t internet_checksum(const std::uint8_t* data, std::size_t len);

}  // namespace mtr
