Let only one request rebuild the key. On a miss, a pod tries to take a short lease in Redis (`SET lock:<key> <pod> NX PX 2000`). The pod that wins queries Postgres and writes the new value; the others serve the previous value if it's still there, or wait a few milliseconds and read the cache again.

The database now sees one rebuild query per expiry instead of hundreds. Collapsing duplicate misses inside each pod (singleflight) helps too, but on its own it still sends one query per pod: 40 pods means 40 queries.
