Plan each server for **60%** of what it can do, so a spike or a failure has room to land. If one server handles **1,500 requests a second**, plan for **900**.

At **5,500 requests a second** that is 5,500 ÷ 900 = 6.1, so **7 servers**. Add **one spare** so losing a server (or deploying one) still leaves 7 doing the work: **8 servers**. With all 8 up, each takes about 690 a second; with one down, each of the other 7 takes about 790, still under the 60% line.
