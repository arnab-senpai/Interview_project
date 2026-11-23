Promotion fixes downtime but not loss: an asynchronous replica can be 100 ms behind, so about 100 RSVPs may disappear.

Add one **synchronous standby**. The primary confirms a write only after the standby has the change on disk too. If the primary dies, the failover manager promotes the standby, which has every confirmed write. Each write now waits for one extra round trip, about 1 ms inside one data centre, more if the standby is far away. The read replicas stay asynchronous, so reads keep their speed.
