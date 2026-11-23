At the sale peak the shop serves about **20,000 product reads a second** and **500 writes** (price and stock changes). A cache that answers **90%** of reads leaves 2,000 reads a second for the database.

The most popular product takes **10%** of all reads, 2,000 a second on its own. Rebuilding its cache entry takes about **200 ms** (a few joins and a price calculation). So if that one key goes missing, about 2,000 × 0.2 = **400 requests** arrive at the database for the same row before the first rebuild finishes. That number, compared with a pool of 200 connections, is the stampede.
