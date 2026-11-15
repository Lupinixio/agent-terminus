# 0001 Dashboard boundary

The dashboard is an operator view. It reads engine state through the contract,
binds to loopback only, and exposes a fixed set of HTTP routes. Storage, child
processes and outbound network calls stay in the engine.
