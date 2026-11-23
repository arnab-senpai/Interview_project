A shop's product pages read from one Postgres database. At 20,000 page reads a second on a sale weekend, the database is far past what one machine can serve, and pages time out.

The team adds Redis in front of Postgres and reads drop from 45 ms to 2 ms. Then, at 8:00 pm sharp on Friday, the cached entry for the most-viewed product expires. Within a fraction of a second hundreds of requests miss the cache together, all ask Postgres for the same row, use up its 200 connections, and retry. Redis is back to full health a moment later, but the pages stay slow until the retries drain.

A cache makes the steady state fast. It also creates failure modes that happen all at once rather than gradually. This chapter adds a cache step by step and then closes the three classic holes: a stampede on a hot key, keys that don't exist, and many keys expiring together.
