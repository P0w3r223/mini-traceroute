// Paths the simulator can trace. Addresses are documentation/private ranges or the address
// the README already uses as its example; nothing here probes a real network.
//
// Per hop: `rtt` is the round-trip time in milliseconds a reply comes back with, `jitter` the
// fraction it varies by, `loss` the chance a single probe goes unanswered, and `silent: true`
// a router that forwards traffic but never sends ICMP — the classic "* * *" line.

export const SCENARIOS = [
  {
    id: 'transit',
    label: 'Home → example.com (clean path)',
    host: 'example.com',
    hostAddr: '192.168.1.42',
    seed: 0x5eed1,
    summary:
      'The ordinary case: every router on the way answers, and the target closes the trace with a port-unreachable.',
    hops: [
      { addr: '192.168.1.1', name: 'router.lan', rtt: 0.51, jitter: 0.12 },
      { addr: '10.64.0.1', name: '', rtt: 8.2, jitter: 0.08 },
      { addr: '83.14.22.9', name: 'core1.waw.example-isp.net', rtt: 9.4, jitter: 0.07 },
      { addr: '195.22.196.14', name: 'ix-waw.example-transit.net', rtt: 12.1, jitter: 0.06 },
      { addr: '213.248.97.33', name: 'ffm-b3.example-transit.net', rtt: 24.6, jitter: 0.05 },
      { addr: '152.195.68.1', name: 'edge-fra.example-cdn.net', rtt: 25.8, jitter: 0.05 },
      { addr: '93.184.216.34', name: '', rtt: 26.4, jitter: 0.04 },
    ],
  },
  {
    id: 'firewall',
    label: 'A hop that never answers',
    host: 'example.com',
    hostAddr: '192.168.1.42',
    seed: 0x5eed2,
    summary:
      'Hop 4 forwards packets but drops ICMP, so it prints as "* * *". The trace continues past it — a silent router hides its identity, not the rest of the path.',
    hops: [
      { addr: '192.168.1.1', name: 'router.lan', rtt: 0.48, jitter: 0.12 },
      { addr: '10.64.0.1', name: '', rtt: 8.4, jitter: 0.08 },
      { addr: '83.14.22.9', name: 'core1.waw.example-isp.net', rtt: 9.6, jitter: 0.07 },
      { addr: '198.51.100.7', name: '', rtt: 11.0, jitter: 0.05, silent: true },
      { addr: '213.248.97.33', name: 'ffm-b3.example-transit.net', rtt: 24.9, jitter: 0.06, loss: 0.34 },
      { addr: '152.195.68.1', name: 'edge-fra.example-cdn.net', rtt: 26.1, jitter: 0.05 },
      { addr: '93.184.216.34', name: '', rtt: 26.7, jitter: 0.04 },
    ],
  },
  {
    id: 'lan',
    label: 'A host two hops away',
    host: 'nas.lan',
    hostAddr: '192.168.1.42',
    seed: 0x5eed3,
    summary:
      'The shortest interesting trace: one router, then the target. Useful for watching the port counter — probe 4 is the first one sent with TTL 2.',
    hops: [
      { addr: '192.168.1.1', name: 'router.lan', rtt: 0.44, jitter: 0.15 },
      { addr: '192.168.9.20', name: 'nas.lan', rtt: 0.93, jitter: 0.2 },
    ],
  },
  {
    id: 'satellite',
    label: 'Long haul over a satellite leg',
    host: 'example.com',
    hostAddr: '192.168.1.42',
    seed: 0x5eed4,
    summary:
      'Hop 5 is a geostationary link: about 620 ms round trip. Drag the timeout below that and every probe past it turns into a "*" — the tool cannot tell a slow router from a missing one.',
    hops: [
      { addr: '192.168.1.1', name: 'router.lan', rtt: 0.55, jitter: 0.12 },
      { addr: '10.64.0.1', name: '', rtt: 9.1, jitter: 0.09 },
      { addr: '83.14.22.9', name: 'core1.waw.example-isp.net', rtt: 11.4, jitter: 0.08 },
      { addr: '203.0.113.9', name: 'teleport-gw.example-sat.net', rtt: 34.8, jitter: 0.1 },
      { addr: '203.0.113.130', name: 'beam7.example-sat.net', rtt: 618.0, jitter: 0.04 },
      { addr: '198.18.24.6', name: 'landing.example-sat.net', rtt: 641.2, jitter: 0.03 },
      { addr: '198.18.31.90', name: '', rtt: 655.7, jitter: 0.03, loss: 0.2 },
      { addr: '93.184.216.34', name: '', rtt: 663.5, jitter: 0.03 },
    ],
  },
];

export const DEFAULT_SCENARIO_ID = 'transit';

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
