A team sizes storage for a new link-sharing service. Their spreadsheet turns daily requests into requests a second by dividing by 100,000 ("a day is about 10^5 seconds"), then turns requests a second back into bytes a day by multiplying by 86,400. The two constants disagree, and the storage estimate comes out 14% low. A second cell divides by 1024³ and labels the answer "GB", so every figure on the page is in GiB without saying so.

Neither slip is dramatic on its own. Together they mean the plan and the bill disagree, and nobody can tell which number to trust. SystemCraft's own old Capacity Lab made both mistakes, which is one reason this chapter replaces it.

Estimation in a design round is not about precision. It is about getting the order of magnitude right, quickly, with steps that anyone can check. This chapter covers the handful of numbers that decide most designs, and shows on one figure which part each number moves.
