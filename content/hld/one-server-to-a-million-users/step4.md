Most CityBeat pages show the same few hundred popular listings. Asking the database for them thousands of times a second is wasted work.

Add an in-memory cache next to the app servers. On a read the app checks the cache first; on a miss it reads the database and stores the answer with a time to live. With an 80% hit rate, only one read query in five reaches the database. Writes still go to the database, which stays the source of truth.
