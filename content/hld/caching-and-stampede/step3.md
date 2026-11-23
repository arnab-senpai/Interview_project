Now look at one key. The most-viewed product takes 2,000 reads a second. When its entry expires, every one of those reads misses until someone rebuilds it, and the rebuild takes 200 ms.

So about 400 identical queries land on the database at once. The pool has 200 connections, so half the requests wait, time out and retry, which adds even more load. This is a cache stampede, also called a thundering herd.
