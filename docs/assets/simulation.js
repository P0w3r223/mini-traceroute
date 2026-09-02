// The traceroute algorithm, mirroring Tracer::run() in src/tracer.cpp: one TTL per round,
// one distinct destination port per probe, and a reply accepted only when the port recovered
// from the ICMP quote is the port this probe was sent to.
//
// The C++ tracer gets its packets from an ISocket; here the "socket" is a scenario, and the
// bytes it produces are pushed through the same parser (assets/icmp.js) the real core uses.

import { buildIcmpError } from './packet.js';
import { IcmpKind, parseIcmpError, ICMP_DEST_UNREACHABLE, ICMP_PORT_UNREACHABLE_CODE, ICMP_TIME_EXCEEDED } from './icmp.js';

// Defaults from include/mini_traceroute/config.hpp.
export const DEFAULTS = {
  maxHops: 30,
  probesPerHop: 3,
  basePort: 33434,
  timeoutMs: 3000,
  numeric: false,
};

export const PROBE_PAYLOAD_BYTES = 32; // config::kProbePayload
const EPHEMERAL_SOURCE_PORT = 49321; // the kernel picks one per socket; it does not change

/**
 * The same checks parse_args() applies in src/main.cpp, so the controls cannot ask for a
 * run the real CLI would reject.
 * @returns {string[]} error messages, empty when the options are valid
 */
export function validate(opts) {
  const errors = [];
  if (!Number.isInteger(opts.maxHops) || opts.maxHops < 1 || opts.maxHops > 255) {
    errors.push('--max-hops must be an integer in 1..255');
  }
  if (!Number.isInteger(opts.probesPerHop) || opts.probesPerHop < 1 || opts.probesPerHop > 255) {
    errors.push('--queries must be an integer in 1..255');
  }
  if (!(opts.timeoutMs > 0) || opts.timeoutMs > 3600_000) {
    errors.push('--timeout must be a number of seconds in (0, 3600]');
  }
  if (!Number.isInteger(opts.basePort) || opts.basePort < 1 || opts.basePort > 65535) {
    errors.push('--port must be an integer in 1..65535');
  }
  // Each probe uses a distinct destination port from base_port up; the whole run has to stay
  // inside the 16-bit port space instead of wrapping and reusing ports.
  if (errors.length === 0 && opts.basePort + opts.maxHops * opts.probesPerHop - 1 > 65535) {
    errors.push('base port + max-hops*queries exceeds 65535 (would wrap)');
  }
  return errors;
}

/**
 * Run the whole trace up front and return it as a list of steps the view can play back.
 * @returns {{header:string, steps:Array<object>, hops:Array<object>, reached:boolean}}
 */
export function runTrace(scenario, opts) {
  const rng = mulberry32(scenario.seed);
  const pathLength = scenario.hops.length;
  const destAddr = scenario.hops[pathLength - 1].addr;

  const steps = [];
  const hops = [];
  let port = opts.basePort;
  let reached = false;

  for (let ttl = 1; ttl <= opts.maxHops; ttl++) {
    const hop = { ttl, probes: [], reachedDest: false };

    for (let probeIndex = 0; probeIndex < opts.probesPerHop; probeIndex++) {
      const dport = port++;
      // Always draw the same number of values per probe, whichever branch is taken, so the
      // run stays reproducible when a slider changes something upstream.
      const rolls = [rng(), rng(), rng()];

      const step = probeStep({ scenario, opts, ttl, probeIndex, dport, destAddr, rolls });
      steps.push(step);

      hop.probes.push({
        responded: step.outcome !== 'timeout',
        addr: step.outcome === 'timeout' ? '' : step.addr,
        name: step.outcome === 'timeout' ? '' : step.name,
        rttMs: step.rttMs,
      });
      if (step.outcome === 'port-unreachable') hop.reachedDest = true;
    }

    hop.line = formatHopLine(hop, opts.numeric);
    steps.push({ kind: 'hop', ttl, hop });
    hops.push(hop);

    if (hop.reachedDest) {
      reached = true;
      break;
    }
  }

  steps.push({ kind: 'end', reached, hopsDone: hops.length });

  return {
    header: `mini-traceroute to ${scenario.host} (${destAddr}), ${opts.maxHops} hops max, ${opts.probesPerHop} probes per hop`,
    steps,
    hops,
    reached,
  };
}

function probeStep({ scenario, opts, ttl, probeIndex, dport, destAddr, rolls }) {
  const pathLength = scenario.hops.length;
  const nodeIndex = Math.min(ttl, pathLength) - 1;
  const node = scenario.hops[nodeIndex];
  const isDestination = ttl >= pathLength;

  const [jitterRoll, lossRoll, strayRoll] = rolls;
  const rttMs = node.rtt * (1 + (node.jitter ?? 0) * (jitterRoll * 2 - 1));

  const step = {
    kind: 'probe',
    ttl,
    probeIndex,
    dport,
    nodeIndex,
    isDestination,
    addr: node.addr,
    name: node.name ?? '',
    rttMs: 0,
    outcome: 'timeout',
    reason: '',
    packets: [],
  };

  if (node.silent) {
    step.reason = 'the router forwards traffic but never sends ICMP';
    return step;
  }
  if (lossRoll < (node.loss ?? 0)) {
    step.reason = 'the reply was lost on the way back';
    return step;
  }
  if (rttMs > opts.timeoutMs) {
    step.reason = `the reply needed ${rttMs.toFixed(0)} ms, past the ${(opts.timeoutMs / 1000).toFixed(3)} s timeout`;
    return step;
  }

  // A raw ICMP socket sees every ICMP message the host receives, not only ours. Occasionally
  // hand the tracer a late reply belonging to an earlier probe first: the inner loop in
  // Tracer::run() has to skip it on the port, and this is where that rule earns its keep.
  if (strayRoll < 0.22 && dport - opts.probesPerHop >= opts.basePort) {
    step.packets.push(
      makePacket({
        scenario,
        destAddr,
        routerAddr: scenario.hops[Math.max(0, nodeIndex - 1)].addr,
        isDestination: false,
        probeTtl: ttl - 1,
        dport: dport - opts.probesPerHop,
        expectedPort: dport,
        note: 'a late reply to an earlier probe — skipped, its quoted port is not ours',
      }),
    );
  }

  step.packets.push(
    makePacket({
      scenario,
      destAddr,
      routerAddr: node.addr,
      isDestination,
      probeTtl: ttl,
      dport,
      expectedPort: dport,
      note: isDestination
        ? 'the target itself: nothing listens on that port, so the trace ends here'
        : 'a router reporting that our TTL ran out',
    }),
  );

  step.outcome = isDestination ? 'port-unreachable' : 'time-exceeded';
  step.rttMs = rttMs;
  return step;
}

// Build a reply and immediately read it back with the real parser, so `matched` is the
// parser's verdict on the bytes rather than an assumption about them.
function makePacket({ scenario, destAddr, routerAddr, isDestination, probeTtl, dport, expectedPort, note }) {
  const { bytes, fields } = buildIcmpError({
    type: isDestination ? ICMP_DEST_UNREACHABLE : ICMP_TIME_EXCEEDED,
    code: isDestination ? ICMP_PORT_UNREACHABLE_CODE : 0,
    routerAddr,
    hostAddr: scenario.hostAddr,
    destAddr,
    probeTtl,
    sourcePort: EPHEMERAL_SOURCE_PORT,
    destPort: dport,
    payloadBytes: PROBE_PAYLOAD_BYTES,
  });

  const parsed = parseIcmpError(bytes);
  return {
    bytes,
    fields,
    parsed,
    sourceAddr: routerAddr,
    note,
    // The acceptance rule from Tracer::run(), verbatim: a recovered port that is this probe's.
    matched: Boolean(parsed && parsed.hasProbePort && parsed.probePort === expectedPort),
    checksumOk: parsed !== null,
    kind: parsed ? parsed.kind : IcmpKind.DestUnreachableOther,
  };
}

/** One output line, formatted the way main.cpp's on_hop callback prints it. */
export function formatHopLine(hop, numeric) {
  let out = String(hop.ttl).padStart(2, ' ') + ' ';
  let lastAddr = '';
  for (const probe of hop.probes) {
    if (!probe.responded) {
      out += ' *';
      continue;
    }
    if (probe.addr !== lastAddr) {
      lastAddr = probe.addr;
      out += !numeric && probe.name ? `  ${probe.name} (${probe.addr})` : `  ${probe.addr}`;
    }
    out += `  ${probe.rttMs.toFixed(3)} ms`;
  }
  return out;
}

// Small seeded PRNG: the same scenario always produces the same trace, so a reader can
// compare two runs and know the difference came from the controls, not from chance.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
