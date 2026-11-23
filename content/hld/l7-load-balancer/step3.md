Servers fail, and deploys restart them one at a time. The balancer must stop sending to a server that can't answer.

It does this with **health checks**: every few seconds it calls a cheap endpoint such as `/healthz` on each server. After, say, 2 failures in a row it takes the server out; after 2 passes it puts it back. Checks every 5 seconds with 2 failures means up to about 10 seconds of errors, so many balancers also watch real traffic and eject a server that returns errors (passive checks).

Removing a server moves its load onto the rest, which is why the plan has a spare: 8 servers, so 7 can carry the peak.
