Use cache-aside. On a read the app asks Redis first. On a hit it returns at once; on a miss it reads Postgres, writes the result to Redis with a time to live (TTL), and returns. On a write it updates Postgres, then deletes the cached entry so the next read rebuilds it.

The database stays the source of truth, and if Redis goes down the app can still read from Postgres, slowly. With a 90% hit rate the database sees 2,000 reads and 500 writes a second.
