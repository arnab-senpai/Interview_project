Check the other path before you stop. Reads still hit the database 10,000 times a second, so it is still red.

The worker already knows each fresh count, so it also writes it into a cache. The API reads counts from the cache; only a miss (a rarely read article) reaches the database. The database now takes about 1,000 batched writes and a trickle of reads, well inside one server's capacity. This is where you wrap up: summarise the design, say what you'd monitor, and name the next bottleneck.
