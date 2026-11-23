Asynchronous copies trail the primary, usually by milliseconds, sometimes by seconds under load. That shows up in a very visible way: a visitor taps "RSVP", the app writes it to the primary, then loads the event page from a replica that hasn't seen the write yet. The RSVP seems to vanish.

The fix is **read your own writes**: for a few seconds after a user writes, send that user's reads to the primary. Everyone else still reads from replicas, where being 100 ms behind doesn't matter. The primary now carries writes plus those recent writers' reads.
