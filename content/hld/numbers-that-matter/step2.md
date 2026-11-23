Next, split the peak into reads and writes. They go to different places and cost different things: reads can be cached and replicated, writes must reach the primary and stay there.

With 99% reads the write path is tiny, about 140 writes a second. Drop the read share to 90% and writes grow tenfold while the front door doesn't move at all. That is why read share is one of the first questions to ask.
