Put a load balancer in front and give it a list of servers. Clients connect to the balancer's address, not to a server, so servers can be added and removed without clients noticing.

The simplest rule is round robin: send each new request to the next server in the list. That only works if any server can answer any request, so the servers must be **stateless**. Logged-in sessions live in Redis (chapter 2), not in one server's memory. With 7 servers each takes about 790 requests a second.
