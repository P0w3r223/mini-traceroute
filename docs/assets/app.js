// Wiring: controls -> simulation -> SVG path, terminal, probe ledger and packet anatomy.
// This is the only file that touches the DOM; the trace itself is computed by simulation.js
// from pure data, the same separation the C++ side draws at ISocket.

import { DEFAULT_SCENARIO_ID, findScenario, SCENARIOS } from './scenarios.js';
import { DEFAULTS, runTrace, validate } from './simulation.js';
import { DEST_PORT_OFFSET } from './packet.js';
import { IcmpKind } from './icmp.js';

// Three horizontal lanes: probes travel above the wire, replies below it, and the labels sit
// clear of both so a moving dot never lands on top of an address.
const PROBE_Y = 42;
const LANE_Y = 80;
const REPLY_Y = 106;
const INDEX_Y = 60;
const ADDR_Y = 130;
const NAME_Y = 143;
const NODE_R = 14;
const SPACING = 112;
const MARGIN_X = 58;
const SVG_HEIGHT = 156;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const dom = {
  scenario: byId('scenario'),
  scenarioNote: byId('scenario-note'),
  maxHops: byId('max-hops'),
  queries: byId('queries'),
  timeout: byId('timeout'),
  basePort: byId('base-port'),
  numeric: byId('numeric'),
  errors: byId('errors'),
  play: byId('play'),
  stepBtn: byId('step'),
  reset: byId('reset'),
  speed: byId('speed'),
  diagram: byId('diagram'),
  terminal: byId('terminal'),
  ledger: byId('ledger-body'),
  ledgerWrap: byId('ledger-wrap'),
  packetTitle: byId('packet-title'),
  hexdump: byId('hexdump'),
  packetFields: byId('packet-fields'),
  packetVerdict: byId('packet-verdict'),
};

/** Everything about the run currently loaded into the view. */
let run = null;
/** Playback position and the token that lets a rebuild abandon animations in flight. */
let player = { index: 0, playing: false, token: { cancelled: false } };
let nodes = [];
let svg = null;
let layer = null; // moving parts live here so they can be cleared without rebuilding the path

function byId(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------- options from the controls

function readOptions() {
  return {
    maxHops: Number(dom.maxHops.value),
    probesPerHop: Number(dom.queries.value),
    basePort: Number(dom.basePort.value),
    timeoutMs: Math.round(Number(dom.timeout.value) * 1000),
    numeric: dom.numeric.checked,
  };
}

function syncOutputs(opts) {
  byId('max-hops-out').value = String(opts.maxHops);
  byId('queries-out').value = String(opts.probesPerHop);
  byId('timeout-out').value = `${(opts.timeoutMs / 1000).toFixed(1)} s`;
  const lastPort = opts.basePort + opts.maxHops * opts.probesPerHop - 1;
  byId('base-port-out').value = `uses ${opts.basePort}–${lastPort}`;
}

// ---------------------------------------------------------------- build / reset

function rebuild() {
  player.token.cancelled = true;
  player = { index: 0, playing: false, token: { cancelled: false } };

  const scenario = findScenario(dom.scenario.value);
  const opts = readOptions();
  syncOutputs(opts);
  dom.scenarioNote.textContent = scenario.summary;

  const errors = validate(opts);
  dom.errors.textContent = errors.map((e) => `error: ${e}`).join('\n');
  const usable = errors.length === 0;
  dom.play.disabled = !usable;
  dom.stepBtn.disabled = !usable;

  drawPath(scenario, opts);
  dom.terminal.textContent = '';
  dom.ledger.replaceChildren();
  clearPacket();

  run = usable ? runTrace(scenario, opts) : null;
  if (run) dom.terminal.textContent = run.header + '\n';
  setPlayLabel(false);
}

function setPlayLabel(playing) {
  if (playing) {
    dom.play.textContent = 'Pause';
  } else if (run && player.index >= run.steps.length) {
    dom.play.textContent = 'Run again';
  } else {
    dom.play.textContent = player.index === 0 ? 'Run the trace' : 'Resume';
  }
}

// ---------------------------------------------------------------- the path diagram

function drawPath(scenario, opts) {
  const count = scenario.hops.length + 1; // the host plus every router on the way
  const width = MARGIN_X * 2 + (count - 1) * SPACING;

  svg = svgEl('svg', {
    class: 'diagram',
    viewBox: `0 0 ${width} ${SVG_HEIGHT}`,
    width,
    height: SVG_HEIGHT,
    role: 'img',
    'aria-label': `Path from this host through ${scenario.hops.length} hops to ${scenario.host}`,
  });

  svg.append(
    svgEl('line', { class: 'lane', x1: MARGIN_X, y1: LANE_Y, x2: width - MARGIN_X, y2: LANE_Y }),
    svgEl('text', { class: 'caption', x: 4, y: 16 }, ''),
  );

  nodes = [];
  for (let i = 0; i < count; i++) {
    const x = MARGIN_X + i * SPACING;
    const isHost = i === 0;
    const hop = isHost ? null : scenario.hops[i - 1];
    const isDest = i === scenario.hops.length;
    const outOfRange = !isHost && i > opts.maxHops;

    const classes = ['node'];
    if (isHost || isDest) classes.push('endpoint');
    if (hop?.silent) classes.push('silent');
    if (outOfRange) classes.push('out-of-range');

    const circle = svgEl('circle', { class: classes.join(' '), cx: x, cy: LANE_Y, r: NODE_R });
    svg.append(
      circle,
      svgEl('text', { class: 'node-index', x, y: INDEX_Y }, isHost ? 'host' : isDest ? 'target' : `hop ${i}`),
      svgEl('text', { class: 'node-addr', x, y: ADDR_Y }, isHost ? scenario.hostAddr : hop.addr),
      svgEl('text', { class: 'node-label', x, y: NAME_Y }, isHost ? 'this machine' : truncate(hop.name)),
    );
    nodes.push({ x, circle, baseClass: classes.join(' ') });
  }

  layer = svgEl('g', {});
  svg.append(layer);
  dom.diagram.replaceChildren(svg);
}

function caption(text) {
  svg.querySelector('.caption').textContent = text;
}

function markNode(index, extra) {
  const node = nodes[index];
  node.circle.setAttribute('class', extra ? `${node.baseClass} ${extra}` : node.baseClass);
}

function clearMarks() {
  nodes.forEach((_, i) => markNode(i, null));
}

// ---------------------------------------------------------------- playback

async function playFrom() {
  const token = player.token;
  while (player.playing && run && player.index < run.steps.length) {
    await runStep(run.steps[player.index], token);
    if (token.cancelled) return;
    player.index += 1;
  }
  if (!token.cancelled && run && player.index >= run.steps.length) {
    player.playing = false;
    setPlayLabel(false);
  }
}

async function runStep(step, token) {
  if (step.kind === 'probe') return animateProbe(step, token);
  if (step.kind === 'hop') {
    dom.terminal.textContent += step.hop.line + '\n';
    return pause(200, token);
  }
  dom.terminal.textContent += step.reached
    ? `\n# target reached after ${step.hopsDone} hops — the ICMP port-unreachable ends the loop\n`
    : `\n# stopped at the ${step.hopsDone}-hop limit without a port-unreachable from the target\n`;
  clearMarks();
  caption('');
  return pause(0, token);
}

async function animateProbe(step, token) {
  const speed = Number(dom.speed.value);
  const segment = duration(130 / speed);
  const target = step.nodeIndex + 1; // node 0 is this host, so hop N is node N

  clearMarks();
  caption(`TTL=${step.ttl} · probe ${step.probeIndex + 1} · UDP dport ${step.dport}`);

  const dot = svgEl('circle', { class: 'probe', cx: nodes[0].x, cy: PROBE_Y, r: 9 });
  const badge = svgEl('text', { class: 'probe-ttl', x: nodes[0].x, y: PROBE_Y + 3 }, String(step.ttl));
  layer.append(dot, badge);

  await animate(segment * target, (t) => {
    const pos = t * target;
    const x = nodes[0].x + (nodes[target].x - nodes[0].x) * t;
    dot.setAttribute('cx', x);
    badge.setAttribute('x', x);
    badge.textContent = String(Math.max(0, step.ttl - Math.floor(pos)));
  }, token);
  if (token.cancelled) return;

  markNode(target, 'active');
  if (!step.isDestination) layer.append(cross(nodes[target].x));
  await pause(duration(150 / speed), token);
  dot.remove();
  badge.remove();
  if (token.cancelled) return;

  if (step.outcome === 'timeout') {
    markNode(target, 'silent');
    caption(`TTL=${step.ttl} · dport ${step.dport} · no reply — ${step.reason}`);
    addLedgerRow(step, null);
    await pause(duration(520 / speed), token);
    if (token.cancelled) return;
    layer.replaceChildren();
    return;
  }

  for (const packet of step.packets) {
    if (token.cancelled) return;
    const from = nodes.findIndex((n, i) => i > 0 && nodeAddr(i) === packet.sourceAddr);
    const originIndex = from > 0 ? from : target;
    await animateReply(packet, originIndex, segment, token);
    if (token.cancelled) return;
    showPacket(step, packet);
    if (!packet.matched) {
      caption(`TTL=${step.ttl} · dport ${step.dport} · reply quotes port ${packet.parsed?.probePort} — not ours, keep waiting`);
      await pause(duration(700 / speed), token);
    }
  }
  if (token.cancelled) return;

  markNode(target, 'replied');
  caption(`TTL=${step.ttl} · dport ${step.dport} · ${step.rttMs.toFixed(3)} ms`);
  addLedgerRow(step, step.packets[step.packets.length - 1]);
  await pause(duration(220 / speed), token);
  if (token.cancelled) return;
  layer.replaceChildren();
}

async function animateReply(packet, originIndex, segment, token) {
  const dot = svgEl('circle', {
    class: packet.kind === IcmpKind.PortUnreachable ? 'reply final' : 'reply',
    cx: nodes[originIndex].x,
    cy: REPLY_Y,
    r: 7,
  });
  layer.append(dot);
  await animate(segment * originIndex * 0.8, (t) => {
    dot.setAttribute('cx', nodes[originIndex].x + (nodes[0].x - nodes[originIndex].x) * t);
  }, token);
  dot.remove();
}

function nodeAddr(index) {
  const addr = svg.querySelectorAll('.node-addr')[index];
  return addr ? addr.textContent : '';
}

function cross(x) {
  const g = svgEl('g', {});
  const d = 8;
  g.append(
    svgEl('line', { class: 'expiry', x1: x - d, y1: LANE_Y - d, x2: x + d, y2: LANE_Y + d }),
    svgEl('line', { class: 'expiry', x1: x + d, y1: LANE_Y - d, x2: x - d, y2: LANE_Y + d }),
  );
  return g;
}

// ---------------------------------------------------------------- probe ledger

const KIND_LABEL = {
  [IcmpKind.TimeExceeded]: 'type 11 — Time Exceeded',
  [IcmpKind.PortUnreachable]: 'type 3/3 — Port Unreachable',
  [IcmpKind.DestUnreachableOther]: 'type 3 — Unreachable (other)',
};

function addLedgerRow(step, packet) {
  const skipped = step.packets.length - 1;
  const row = document.createElement('tr');
  const cells = packet
    ? [
        [String(step.ttl), 'num'],
        [String(step.probeIndex + 1), 'num'],
        [String(step.dport), 'num mono'],
        [packet.sourceAddr, 'mono'],
        [KIND_LABEL[packet.kind] ?? '—', ''],
        [`${step.rttMs.toFixed(3)} ms`, 'num probe-ok'],
        [skipped > 0 ? `${skipped} unrelated reply skipped on the port` : '', 'note'],
      ]
    : [
        [String(step.ttl), 'num'],
        [String(step.probeIndex + 1), 'num'],
        [String(step.dport), 'num mono'],
        ['—', 'mono'],
        ['no reply', ''],
        ['*', 'num probe-miss'],
        [step.reason, 'note'],
      ];

  for (const [text, cls] of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    row.append(td);
  }
  dom.ledger.append(row);
  // Scroll the ledger's own box, never the page — the diagram has to stay in view.
  dom.ledgerWrap.scrollTop = dom.ledgerWrap.scrollHeight;
}

// ---------------------------------------------------------------- packet anatomy

function clearPacket() {
  dom.packetTitle.textContent = 'No reply inspected yet';
  dom.hexdump.innerHTML = '<span class="empty">Run the trace — the first ICMP reply lands here.</span>';
  dom.packetFields.replaceChildren();
  dom.packetVerdict.textContent = '';
}

function showPacket(step, packet) {
  dom.packetTitle.textContent = `${packet.bytes.length} bytes from ${packet.sourceAddr} — ${packet.note}`;
  renderHexdump(packet);
  renderFields(packet);
  renderVerdict(step, packet);
}

function renderHexdump(packet) {
  const groupOf = new Array(packet.bytes.length).fill('outer');
  for (const field of packet.fields) {
    for (let i = field.offset; i < field.offset + field.length; i++) groupOf[i] = field.group;
  }

  const frag = document.createDocumentFragment();
  for (let base = 0; base < packet.bytes.length; base += 16) {
    const row = document.createElement('div');
    row.className = 'row';
    const off = document.createElement('span');
    off.className = 'off';
    off.textContent = base.toString(16).padStart(4, '0') + '  ';
    row.append(off);

    for (let i = base; i < Math.min(base + 16, packet.bytes.length); i++) {
      const isPort = i >= DEST_PORT_OFFSET && i < DEST_PORT_OFFSET + 2;
      const span = document.createElement('span');
      span.className = isPort ? 'b b-dport' : `b b-${groupOf[i]}`;
      span.textContent = packet.bytes[i].toString(16).padStart(2, '0');
      row.append(span, document.createTextNode(' '));
    }
    frag.append(row);
  }
  dom.hexdump.replaceChildren(frag);
}

function renderFields(packet) {
  const groupTitle = {
    outer: 'Outer IPv4 — who is telling us',
    icmp: 'ICMP — what happened',
    inner: 'Quoted IPv4 — the probe that caused it',
    udp: 'Quoted UDP — the first 8 bytes, which is the whole header',
  };

  const frag = document.createDocumentFragment();
  let lastGroup = null;
  for (const field of packet.fields.filter((f) => f.show)) {
    if (field.group !== lastGroup) {
      lastGroup = field.group;
      const head = document.createElement('tr');
      const th = document.createElement('th');
      th.colSpan = 3;
      th.textContent = groupTitle[field.group];
      head.append(th);
      frag.append(head);
    }
    const row = document.createElement('tr');
    if (field.highlight) row.className = 'matched';
    for (const [text, cls] of [
      [`+${field.offset}`, 'num mono'],
      [field.name, ''],
      [field.value, 'mono'],
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      row.append(td);
    }
    frag.append(row);
  }
  dom.packetFields.replaceChildren(frag);
}

function renderVerdict(step, packet) {
  const port = packet.parsed?.hasProbePort ? packet.parsed.probePort : null;
  dom.packetVerdict.replaceChildren();

  const line = (text, mark) => {
    const p = document.createElement('p');
    if (mark) {
      const span = document.createElement('span');
      span.className = mark;
      span.textContent = mark === 'ok' ? '  accepted' : '  skipped';
      p.append(document.createTextNode(text), span);
    } else {
      p.textContent = text;
    }
    dom.packetVerdict.append(p);
  };

  line(`internet_checksum(icmp) == 0  →  ${packet.checksumOk ? 'the message is intact' : 'corrupt, dropped'}`);
  line(`quoted UDP destination port  →  ${port ?? 'could not be recovered'}`);
  line(
    `probe waiting on port ${step.dport}  →  ${port === step.dport ? 'same port, this reply is ours' : 'different port, not ours'}`,
    packet.matched ? 'ok' : 'no',
  );
}

// ---------------------------------------------------------------- animation primitives

function duration(ms) {
  return reducedMotion.matches ? 0 : ms;
}

function animate(ms, onFrame, token) {
  if (ms <= 0) {
    onFrame(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      if (token.cancelled) return resolve();
      const t = Math.min(1, (now - start) / ms);
      onFrame(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function pause(ms, token) {
  const wait = reducedMotion.matches ? Math.min(ms, 40) : ms;
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
  // The token is checked by the caller after every await, so a stale timer resolves harmlessly.
}

// ---------------------------------------------------------------- helpers and wiring

function svgEl(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function truncate(name, max = 17) {
  if (!name) return '';
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function togglePlay() {
  if (!run) return;
  if (player.playing) {
    player.playing = false;
    setPlayLabel(false);
    return;
  }
  if (player.index >= run.steps.length) rebuild();
  player.playing = true;
  setPlayLabel(true);
  playFrom();
}

async function singleStep() {
  if (!run || player.playing || player.index >= run.steps.length) return;
  const token = player.token;
  dom.stepBtn.disabled = true;
  await runStep(run.steps[player.index], token);
  if (!token.cancelled) {
    player.index += 1;
    setPlayLabel(false);
  }
  dom.stepBtn.disabled = false;
}

function init() {
  for (const scenario of SCENARIOS) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.label;
    dom.scenario.append(option);
  }
  dom.scenario.value = DEFAULT_SCENARIO_ID;
  dom.maxHops.value = String(DEFAULTS.maxHops);
  dom.queries.value = String(DEFAULTS.probesPerHop);
  dom.basePort.value = String(DEFAULTS.basePort);
  dom.timeout.value = String(DEFAULTS.timeoutMs / 1000);

  for (const control of [dom.scenario, dom.maxHops, dom.queries, dom.timeout, dom.basePort, dom.numeric]) {
    control.addEventListener('input', rebuild);
  }
  dom.play.addEventListener('click', togglePlay);
  dom.stepBtn.addEventListener('click', singleStep);
  dom.reset.addEventListener('click', rebuild);

  rebuild();
  togglePlay(); // the page is a demo; start it moving without asking
}

init();
