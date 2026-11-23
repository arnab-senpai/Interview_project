Not all requests cost the same. A listing page takes about 20 ms; a guest-list export takes about 400 ms. Round robin counts requests, not work, so a server that happens to get several exports falls behind while the others idle.

Switch to **least outstanding requests**: send each request to the server with the fewest requests still in progress. A server stuck on slow work has more in flight, so it gets less. Checking every server on every request is costly with a big fleet, so a common shortcut is **power of two choices**: pick two servers at random and send to the less busy one.
