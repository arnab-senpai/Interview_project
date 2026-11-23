A scraper starts asking for product ids that don't exist. Every such read misses the cache (there is nothing to cache) and reaches Postgres, which is called cache penetration.

Put a shared Bloom filter in front: a compact bit array, kept in Redis, that answers "definitely not present" or "maybe present". Every product create adds its id. With a 1% false-positive rate it turns away about 99% of the bogus lookups before they reach the cache or the database.
