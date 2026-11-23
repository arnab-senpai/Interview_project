When the primary dies, a replica must take over (be **promoted**) and the app must start writing to it. Doing this by hand at 21:40 takes too long, so use a **failover manager**.

The hard part is deciding the primary is really dead. A slow network looks the same as a dead machine. If two machines each believe they are primary, both accept writes and the data splits (**split brain**). So the manager runs on 3 members that must agree by majority, holds a leader lock that the primary must keep renewing, and makes sure the old primary stops accepting writes before a new one is promoted.
