A cache sits on the read path, so its hit rate decides how many reads the database still sees: database reads = peak reads × (1 − hit rate).

The cache's own size is a different question. It depends on how many **distinct** items are popular, not on how many times they are read. Counting every read of a popular link would size the cache for the same item thousands of times over.
