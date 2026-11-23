Plan each database server for **60%** of its **3,000 queries a second**: about **1,800**. One server alone gets 4,000 + 1,000 = **5,000**, nearly three times that.

Writes must all go to one place (the primary), and **1,000 a second** fits. Reads can go to copies: 4,000 ÷ 1,800 = 2.2, so **3 read replicas**, each about 1,330 a second.

Copies run a little behind. If a replica trails by **100 ms** and the primary dies, the writes from that last 100 ms may not have reached it: 1,000 × 0.1 = about **100 writes** at risk.
