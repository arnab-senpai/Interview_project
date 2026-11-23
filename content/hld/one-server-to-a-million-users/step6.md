The database is now the one part that is hard to copy, and it still takes every write and every cache miss. Reads are 95% of the queries, so give them their own machines.

Add a read replica. The primary takes all writes and streams its changes to the replica; the app sends cache-miss reads to the replica. If the primary fails, the replica can be promoted, so the database is no longer a single point of failure either. The cost is replication lag: a read right after a write may briefly see old data.
