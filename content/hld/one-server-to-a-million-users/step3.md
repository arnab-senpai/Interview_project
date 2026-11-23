One app server is still one point of failure, and still red at the peak. Put a load balancer in front and run several identical app servers behind it. The load balancer spreads requests and stops sending traffic to a server that fails its health check.

This only works if any server can handle any request. Login sessions and uploaded files must not live on one server's local disk, so sessions move to a shared store (or a signed cookie) and images move off the app servers. That is what "stateless" means here.
