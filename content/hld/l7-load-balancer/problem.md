CityBeat now runs in ten cities. On a Friday evening about **5,500 page and API requests a second** reach the app tier, after the CDN has taken the images.

The team added servers and a load balancer when they grew past one machine, and it mostly works. But three things went wrong last month. When one server crashed, about one request in seven failed for half a minute. When the mobile app moved to HTTP/2, the four oldest servers ran hot while three new ones sat idle. And on the night a venue exported its guest list, one server stalled behind slow export requests while the others were quiet.

A load balancer looks like one box on a diagram. This chapter opens it up: how many servers it needs behind it, how it notices a dead one, how it picks a server for each request, and how it avoids becoming the one part that can take everything down.
