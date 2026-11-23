Start from people, not servers. A million daily users who each make about 30 requests (pages, images, RSVPs) is 30 million requests a day.

A day has **86,400 seconds**, so the average is 30,000,000 ÷ 86,400 ≈ **350 requests a second**. Traffic is not flat: Friday evening runs about 3× the daily average, so the design has to carry roughly **1,000 requests a second** at peak.

Two more numbers shape the design. About half of those requests are for images and scripts, which skip the database entirely. Of the rest, 95% are reads (browsing listings), and each page runs about 4 database queries. The sliders above the figures start at these values. Move them, and every figure in this chapter recomputes.
