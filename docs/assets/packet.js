// Builds the ICMP error packets the simulator hands to the parser, byte for byte, with real
// RFC 1071 checksums. Nothing here is decorative: the same bytes are rendered as the hexdump,
// fed through parseIcmpError(), and used to decide whether a reply matches a probe.

import { internetChecksum } from './checksum.js';
import { ipv4FromString, ipv4ToString, PROTOCOL_ICMP, PROTOCOL_UDP } from './ipv4.js';

// An IPv4 header with no options, which is what routers emit for these errors.
const IP_HEADER_BYTES = 20;
const ICMP_HEADER_BYTES = 8;
const UDP_HEADER_BYTES = 8;

const OUTER_IP = 0;
const ICMP = OUTER_IP + IP_HEADER_BYTES; // 20
const INNER_IP = ICMP + ICMP_HEADER_BYTES; // 28 — the quoted datagram starts here
const INNER_UDP = INNER_IP + IP_HEADER_BYTES; // 48
const TOTAL = INNER_UDP + UDP_HEADER_BYTES; // 56

/**
 * Assemble an ICMP error that quotes one of our UDP probes.
 * @param {{type:number, code:number, routerAddr:string, hostAddr:string, destAddr:string,
 *          probeTtl:number, sourcePort:number, destPort:number, payloadBytes:number}} spec
 * @returns {{bytes:Uint8Array, fields:Array<object>}}
 */
export function buildIcmpError(spec) {
  const bytes = new Uint8Array(TOTAL);
  const view = new DataView(bytes.buffer);

  // --- outer IPv4: from the router that reports the error, back to us -------------------
  writeIpv4Header(view, OUTER_IP, {
    totalLength: TOTAL,
    ttl: 64,
    protocol: PROTOCOL_ICMP,
    src: spec.routerAddr,
    dst: spec.hostAddr,
  });

  // --- ICMP header: type/code, checksum, four unused bytes ------------------------------
  view.setUint8(ICMP, spec.type);
  view.setUint8(ICMP + 1, spec.code);
  view.setUint16(ICMP + 2, 0); // checksum computed once the quote is in place
  view.setUint32(ICMP + 4, 0); // unused for type 11 code 0 and type 3 code 3

  // --- the quote: our original IPv4 header and the first 8 bytes of the UDP datagram -----
  const innerTotalLength = IP_HEADER_BYTES + UDP_HEADER_BYTES + spec.payloadBytes;
  writeIpv4Header(view, INNER_IP, {
    totalLength: innerTotalLength,
    ttl: spec.probeTtl, // the TTL we chose; the router decremented its copy to zero
    protocol: PROTOCOL_UDP,
    src: spec.hostAddr,
    dst: spec.destAddr,
  });

  const udpLength = UDP_HEADER_BYTES + spec.payloadBytes;
  view.setUint16(INNER_UDP, spec.sourcePort);
  view.setUint16(INNER_UDP + 2, spec.destPort); // the field the whole matching rests on
  view.setUint16(INNER_UDP + 4, udpLength);
  view.setUint16(INNER_UDP + 6, udpChecksum(spec, udpLength));

  view.setUint16(ICMP + 2, internetChecksum(bytes, ICMP, TOTAL));

  return { bytes, fields: describe(bytes, spec) };
}

/** Byte offset of the quoted UDP destination port, for highlighting it in the hexdump. */
export const DEST_PORT_OFFSET = INNER_UDP + 2;

function writeIpv4Header(view, at, h) {
  view.setUint8(at, 0x45); // version 4, IHL 5 words (no options)
  view.setUint8(at + 1, 0); // DSCP / ECN
  view.setUint16(at + 2, h.totalLength);
  view.setUint16(at + 4, 0); // identification
  view.setUint16(at + 6, 0x4000); // don't fragment
  view.setUint8(at + 8, h.ttl);
  view.setUint8(at + 9, h.protocol);
  view.setUint16(at + 10, 0); // header checksum, filled in below
  view.setUint32(at + 12, ipv4FromString(h.src));
  view.setUint32(at + 16, ipv4FromString(h.dst));

  const bytes = new Uint8Array(view.buffer);
  view.setUint16(at + 10, internetChecksum(bytes, at, at + IP_HEADER_BYTES));
}

// A UDP checksum covers a pseudo-header built from the IP addresses plus the datagram
// itself. The probe payload is kProbePayload zero bytes, which contribute nothing to a
// one's-complement sum — so the real value is computable here, not invented.
function udpChecksum(spec, udpLength) {
  const buf = new Uint8Array(12 + UDP_HEADER_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint32(0, ipv4FromString(spec.hostAddr));
  view.setUint32(4, ipv4FromString(spec.destAddr));
  view.setUint8(8, 0);
  view.setUint8(9, PROTOCOL_UDP);
  view.setUint16(10, udpLength);
  view.setUint16(12, spec.sourcePort);
  view.setUint16(14, spec.destPort);
  view.setUint16(16, udpLength);
  view.setUint16(18, 0); // the checksum field itself reads as zero while computing
  return internetChecksum(buf);
}

const ICMP_TYPE_NAMES = { 3: 'Destination Unreachable', 11: 'Time Exceeded' };
const ICMP_CODE_NAMES = { '3/3': 'Port Unreachable', '11/0': 'TTL expired in transit' };

// A complete byte map of the packet: every byte belongs to exactly one entry, so the hexdump
// can colour itself from this list. `show` marks the fields worth a row in the table.
function describe(bytes, spec) {
  const view = new DataView(bytes.buffer);
  const hex16 = (at) => '0x' + view.getUint16(at).toString(16).padStart(4, '0');
  const addr = (at) => ipv4ToString(view.getUint32(at));

  const ipFields = (at, group, who) => [
    { offset: at, length: 1, group, name: 'Version / IHL', value: '4 / 5 words (20 B)' },
    { offset: at + 1, length: 1, group, name: 'DSCP / ECN', value: '0' },
    { offset: at + 2, length: 2, group, name: 'Total length', value: `${view.getUint16(at + 2)} B`, show: true },
    { offset: at + 4, length: 2, group, name: 'Identification', value: '0' },
    { offset: at + 6, length: 2, group, name: 'Flags / fragment offset', value: 'DF' },
    { offset: at + 8, length: 1, group, name: 'TTL', value: String(view.getUint8(at + 8)), show: group === 'inner' },
    {
      offset: at + 9,
      length: 1,
      group,
      name: 'Protocol',
      value: view.getUint8(at + 9) === PROTOCOL_ICMP ? '1 — ICMP' : '17 — UDP',
      show: true,
    },
    { offset: at + 10, length: 2, group, name: 'Header checksum', value: hex16(at + 10) },
    { offset: at + 12, length: 4, group, name: `Source (${who.src})`, value: addr(at + 12), show: true },
    { offset: at + 16, length: 4, group, name: `Destination (${who.dst})`, value: addr(at + 16), show: true },
  ];

  const typeName = ICMP_TYPE_NAMES[spec.type] ?? 'other';
  const codeName = ICMP_CODE_NAMES[`${spec.type}/${spec.code}`] ?? '—';

  return [
    ...ipFields(OUTER_IP, 'outer', { src: 'the reporting router', dst: 'us' }),
    { offset: ICMP, length: 1, group: 'icmp', name: 'ICMP type', value: `${spec.type} — ${typeName}`, show: true },
    { offset: ICMP + 1, length: 1, group: 'icmp', name: 'ICMP code', value: `${spec.code} — ${codeName}`, show: true },
    {
      offset: ICMP + 2,
      length: 2,
      group: 'icmp',
      name: 'ICMP checksum',
      value: hex16(ICMP + 2),
      show: true,
    },
    { offset: ICMP + 4, length: 4, group: 'icmp', name: 'Unused', value: '0' },
    ...ipFields(INNER_IP, 'inner', { src: 'us', dst: 'the target' }),
    {
      offset: INNER_UDP,
      length: 2,
      group: 'udp',
      name: 'UDP source port',
      value: String(view.getUint16(INNER_UDP)),
      show: true,
    },
    {
      offset: DEST_PORT_OFFSET,
      length: 2,
      group: 'udp',
      name: 'UDP destination port',
      value: String(view.getUint16(DEST_PORT_OFFSET)),
      show: true,
      highlight: true,
    },
    {
      offset: INNER_UDP + 4,
      length: 2,
      group: 'udp',
      name: 'UDP length',
      value: `${view.getUint16(INNER_UDP + 4)} B (8 header + ${spec.payloadBytes} payload)`,
      show: true,
    },
    { offset: INNER_UDP + 6, length: 2, group: 'udp', name: 'UDP checksum', value: hex16(INNER_UDP + 6) },
  ];
}
