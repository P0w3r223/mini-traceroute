#pragma once

// Central configuration: default probe parameters. No I/O here — only constants.
// The CLI may override these from command-line flags; nothing else hardcodes them.

#include <chrono>
#include <cstddef>
#include <cstdint>

namespace mtr::config {

// Classic traceroute sends UDP probes to an unlikely-to-be-open high port and bumps
// the destination port per probe so replies can be matched back to the probe that
// triggered them. 33434 is the historical base port (RFC 8335 background).
inline constexpr std::uint16_t kBasePort = 33434;

inline constexpr int kMaxHops = 30;
inline constexpr int kProbesPerHop = 3;
inline constexpr std::chrono::milliseconds kProbeTimeout{3000};

// Bytes of (zeroed) UDP payload per probe. Small and fixed — only the headers matter.
inline constexpr std::size_t kProbePayload = 32;

}  // namespace mtr::config
