// ICMP classification and probe-port recovery — a port of src/icmp.cpp.
// The simulator feeds real byte arrays through this function, so the port a reply is matched
// on is genuinely read back out of the packet, exactly as the C++ core does it.

import { internetChecksum } from './checksum.js';
import { parseIpv4Header, PROTOCOL_ICMP, PROTOCOL_UDP } from './ipv4.js';

export const ICMP_DEST_UNREACHABLE = 3;
export const ICMP_TIME_EXCEEDED = 11;
export const ICMP_PORT_UNREACHABLE_CODE = 3;

/** What an intermediate router or the destination told us about a probe. */
export const IcmpKind = {
  TimeExceeded: 'TimeExceeded', // type 11 — a router decremented TTL to zero
  PortUnreachable: 'PortUnreachable', // type 3 / code 3 — the destination was reached
  DestUnreachableOther: 'DestUnreachableOther', // type 3, any other code
};

/**
 * Parse a raw IP packet as delivered by a SOCK_RAW/IPPROTO_ICMP socket: an outer IPv4
 * header, an ICMP header, and — for errors — the embedded original datagram (IPv4 + the
 * first 8 bytes of UDP), from which the probe's destination port is recovered.
 * @param {Uint8Array} packet
 * @returns {{kind:string, probePort:number, hasProbePort:boolean,
 *            type:number, code:number, sourceAddr:number} | null}
 *          null when the buffer is not a parseable ICMP-over-IPv4 error.
 */
export function parseIcmpError(packet) {
  const len = packet.length;
  const outer = parseIpv4Header(packet, 0, len);
  if (!outer || outer.protocol !== PROTOCOL_ICMP) return null;

  const icmpOff = outer.headerBytes;
  if (icmpOff + 8 > len) return null; // need at least the 8-byte ICMP header

  // Verify the ICMP checksum before trusting the reply. Bound the message by the IP total
  // length when it is sane (a raw socket may hand us trailing bytes); a valid ICMP message
  // sums to zero under the internet checksum.
  let icmpLen = len - icmpOff;
  const declared = outer.totalLength >= outer.headerBytes ? outer.totalLength - outer.headerBytes : 0;
  if (declared > 0 && declared <= icmpLen) icmpLen = declared;
  if (internetChecksum(packet, icmpOff, icmpOff + icmpLen) !== 0) return null;

  const type = packet[icmpOff];
  const code = packet[icmpOff + 1];

  let kind;
  if (type === ICMP_TIME_EXCEEDED) {
    kind = IcmpKind.TimeExceeded;
  } else if (type === ICMP_DEST_UNREACHABLE) {
    kind = code === ICMP_PORT_UNREACHABLE_CODE ? IcmpKind.PortUnreachable : IcmpKind.DestUnreachableOther;
  } else {
    // Any other ICMP message is not a hop signal and has no probe to match — decline it so
    // it can never be attributed to a probe.
    return null;
  }

  const resp = { kind, probePort: 0, hasProbePort: false, type, code, sourceAddr: outer.srcAddr };

  // The error echoes back the datagram that triggered it: the original IPv4 header followed
  // by its first 8 bytes (the whole UDP header). The destination port there is how a reply is
  // tied to the exact probe that caused it.
  const innerOff = icmpOff + 8;
  const inner = parseIpv4Header(packet, innerOff, len - innerOff);
  if (inner && inner.protocol === PROTOCOL_UDP) {
    const udpOff = innerOff + inner.headerBytes;
    if (udpOff + 4 <= len) {
      resp.probePort = (packet[udpOff + 2] << 8) | packet[udpOff + 3];
      resp.hasProbePort = true;
    }
  }
  return resp;
}
