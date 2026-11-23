Add **read replicas**. The primary takes every write and records each change in its log (Postgres calls it the write-ahead log, or WAL). Each replica receives that log and applies the same changes, so it holds the same data a moment later.

The app sends writes to the primary and most reads to a replica. With 3 replicas each serves about 1,330 reads a second, and the primary handles the 1,000 writes. Copying is **asynchronous**: the primary confirms a write without waiting for the replicas.
