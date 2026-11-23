Every visit starts with a name. The browser asks a **DNS resolver** (usually run by the internet provider) for the address of citybeat.com. The resolver asks the name servers in turn and gets back the load balancer's address with a **TTL**, say 300 seconds. Until the TTL runs out, the resolver answers from its own copy, so most lookups are fast and don't reach CityBeat's name servers.

Then everything (pages, images, scripts) travels to Frankfurt. The 8 app servers carry 10,700 requests a second, far over the 60% line, and far visitors pay 150 ms on every round trip.
