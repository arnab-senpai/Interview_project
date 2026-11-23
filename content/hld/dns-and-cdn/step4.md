Each edge city fills its own copy. When a new festival poster goes live, the first visitor in each of 30 edge cities misses, so Frankfurt gets 30 requests for the same file at once. With a big release of new files, those misses add up.

Add an **origin shield**: one CDN location, chosen near the origin, that all edges ask instead of the origin. The edges' misses meet there, and the shield fetches each file from Frankfurt once. It also answers about 80% of edge misses from its own copy, so the origin sees about 52 file requests a second.
