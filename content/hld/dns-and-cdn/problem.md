CityBeat's servers sit in one data centre in Frankfurt. The ten new cities include Mumbai and São Paulo, and visitors there say pages feel slow even when the servers are quiet.

Nothing is overloaded at their end. A round trip from Mumbai to Frankfurt takes about 150 ms, and loading one page needs several round trips: to look up the address, to open a connection, to set up encryption, then to fetch the page. Light in fibre can't go faster, so the only fix is to answer from somewhere closer.

There is a second problem. About half of all requests are for images and scripts, and when a festival poster goes viral, thousands of browsers ask Frankfurt for the same 200 KB file every second. This chapter shows how a name becomes an address (DNS), and how a content delivery network (CDN) answers most of those requests near the visitor, so the servers only see what really needs them.
