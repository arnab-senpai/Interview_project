The site serves about **300 million article views a day**. Spread over 86,400 seconds that is about **3,500 views a second** on average, and the morning news peak runs about 3× higher: roughly **10,000 a second**.

Every view does two things: it adds one to the article's count and it shows the current count. So at the peak the counter takes about 10,000 increments and 10,000 reads a second. Those two numbers decide the design. Everything else (how many articles exist, how many bytes a count takes) is small enough to ignore for now, and saying so out loud is part of the answer.
