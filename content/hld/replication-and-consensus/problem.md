CityBeat's cache (chapter 5) took most reads off the database, but at the Friday peak in ten cities about **4,000 read queries** and **1,000 write queries** a second still reach one Postgres server. It was planned for 3,000.

The database is also the one part nobody can restart casually. Last month its disk failed at 21:40. The site was down for two hours while someone restored last night's backup, and every RSVP made that evening was gone.

Both problems have the same first answer: keep copies of the data on more than one machine. This is **replication**. Copies can share the reading work and take over when a machine dies. But copies run a little behind, and deciding which copy is in charge after a failure is harder than it looks. This chapter adds copies one step at a time and shows what each one buys and costs.
