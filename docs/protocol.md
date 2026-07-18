# How traceroute works (the UDP + ICMP method)

`mini-traceroute` discovers the routers on the path to a host by abusing one field of the
IPv4 header — the **Time To Live (TTL)** — together with the ICMP error messages that
routers are obliged to send.

## TTL: a hop counter

Every IPv4 packet carries an 8-bit TTL. Each router that forwards the packet decrements it
by one. When a router decrements the TTL **to zero**, it must drop the packet and send an
**ICMP Time Exceeded** (type 11) message back to the source. That reply's source address is
the router itself — so it reveals one hop on the path.

The trick: send probes with deliberately small TTLs.

- TTL = 1 → the **first** router drops it and identifies itself.
- TTL = 2 → the **second** router does.
- … and so on, one hop further each round.

## The probe: a UDP datagram to an unused port

Each probe is a small **UDP** datagram sent to the destination on an **unlikely-to-be-open,
high port** (base 33434, incremented per probe). When a probe finally reaches the
destination (TTL large enough), nothing is listening on that port, so the destination
replies with **ICMP Destination Unreachable / Port Unreachable** (type 3, code 3). That is
the signal that the target has been reached and the trace can stop.

```
 host                 router (each hop)                 destination
  |   UDP dport=33434+     |                                 |
  |   IP TTL=1 ----------->X   TTL reaches 0 -> dropped       |
  |   <---- ICMP Time Exceeded (type 11) ----                 |
  |                        |                                  |
  |   IP TTL=2 ----------->|------------>X                    |
  |   <-------- ICMP Time Exceeded (type 11) --------         |
  |                        |             |                    |
  |   IP TTL=n ----------->|------------>|------------------->|  (port closed)
  |   <----- ICMP Destination Unreachable / Port (type 3, code 3) -----|
```

## Matching a reply to its probe

An ICMP error message quotes the packet that caused it: the **original IPv4 header plus its
first 8 bytes** — which, for a UDP probe, is the whole UDP header. So the reply contains the
**destination port** we chose for that probe. Because every probe uses a distinct
destination port, the tool matches each ICMP reply back to the exact probe that triggered
it, even if replies arrive out of order. (This is the classic BSD-traceroute technique.)

## Round-trip time

The tool timestamps each probe on send and again when its matching reply arrives; the
difference is the round-trip time (RTT) printed per probe. Several probes per hop (default
3) show jitter and cope with occasional loss (`*` marks a probe that timed out).

## Why raw sockets / privileges

Sending the UDP probe only needs an ordinary datagram socket with the `IP_TTL` option set.
**Receiving** the ICMP replies needs a **raw ICMP socket** (`SOCK_RAW`, `IPPROTO_ICMP`),
which the operating system restricts to root or a process holding the `CAP_NET_RAW`
capability. That is why a live trace must be run with privileges; see the README.
