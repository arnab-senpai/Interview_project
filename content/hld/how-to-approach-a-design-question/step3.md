Fix one thing at a time. The writes are the problem, and most of them are "+1 for the same popular article". Instead of writing each one, the API drops a view event onto a queue and returns at once.

A counter worker reads events in batches, adds them up per article, and every few seconds writes one `views = views + n` per article it saw. If 5,000 different articles are read in a 5-second window, that is about 1,000 database writes a second instead of 10,000. The cost: counts lag by a few seconds, which the requirements said is fine.
