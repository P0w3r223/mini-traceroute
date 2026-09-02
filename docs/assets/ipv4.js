// Minimal IPv4 header view — a port of src/ipv4.cpp. The C++ core defines its own wire
// struct instead of including <netinet/ip.h>; this file is the same idea in JavaScript, so
// the page parses the bytes it displays rather than trusting a value carried alongside them.

export const PROTOCOL_ICMP = 1;
export const PROTOCOL_UDP = 17;

/**
 * Parse an IPv4 header from the front of `data` (optionally at an offset).
 * @returns {{ihlWords:number, protocol:number, totalLength:number, ttl:number,
 *            srcAddr:number, dstAddr:number, headerBytes:number} | null}
 *          null when the buffer is too short, the version is not 4, or the declared
 *          header length is invalid.
 */
export function parseIpv4Header(data, offset = 0, len = data.length - offset) {
  if (!data || len < 20) return null;

  const version = data[offset] >> 4;
  const ihl = data[offset] & 0x0f;
  if (version !== 4 || ihl < 5) return null;

  const headerBytes = ihl * 4;
  if (headerBytes > len) return null;

  return {
    ihlWords: ihl,
    totalLength: (data[offset + 2] << 8) | data[offset + 3],
    ttl: data[offset + 8],
    protocol: data[offset + 9],
    srcAddr: readAddr(data, offset + 12),
    dstAddr: readAddr(data, offset + 16),
    headerBytes,
  };
}

/** Format a host-order address as dotted decimal (0x01020304 -> "1.2.3.4"). */
export function ipv4ToString(addrHostOrder) {
  return [24, 16, 8, 0].map((shift) => (addrHostOrder >>> shift) & 0xff).join('.');
}

/** Parse dotted decimal into a host-order 32-bit address. */
export function ipv4FromString(dotted) {
  const parts = dotted.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`not a dotted IPv4 address: ${dotted}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function readAddr(data, at) {
  return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
}
