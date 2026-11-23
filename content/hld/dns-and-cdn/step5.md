Many pages are also the same for everyone: an event page, a city's listings. They change, but a visitor won't notice a page that is 30 seconds old.

Send public pages through the CDN too, with `Cache-Control: public, max-age=30`. The edge answers repeat visits for 30 seconds, then asks the origin again. Pages that depend on who is logged in (my RSVPs, my settings) are marked `private, no-store` and go to the origin every time. If 60% of page requests are public and the edge answers 80% of them, the app tier's load drops to about 2,900 requests a second.
