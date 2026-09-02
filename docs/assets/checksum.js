// Internet checksum (RFC 1071) — a direct port of src/checksum.cpp, so the packets this page
// shows are checksummed by the same algorithm the C++ tool verifies them with, not faked.

/**
 * One's-complement sum of 16-bit big-endian words, folded and inverted.
 * @param {Uint8Array} data
 * @param {number} [start] first byte to include
 * @param {number} [end] one past the last byte to include
 * @returns {number} the 16-bit checksum
 */
export function internetChecksum(data, start = 0, end = data.length) {
  let sum = 0;

  let i = start;
  for (; i + 1 < end; i += 2) {
    sum += (data[i] << 8) | data[i + 1];
  }
  if (i < end) {
    // A trailing odd byte is padded with a zero low byte.
    sum += data[i] << 8;
  }

  // Fold the carries back into the low 16 bits, then take the one's complement.
  while (sum >>> 16) {
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return ~sum & 0xffff;
}
