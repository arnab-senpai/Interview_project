Now the balancer itself is the single point of failure: if it dies, every request fails even though 8 servers are healthy.

Run **two balancer instances** that share the public address. With a cloud load balancer the provider does this for you across zones. With your own (NGINX, HAProxy, Envoy) you either float one virtual IP between a pair, or put both addresses in DNS and let health-checked DNS drop a dead one. Each instance can carry the whole peak alone, so losing one changes nothing for users.
