At the Friday peak CityBeat gets about **5,500 page and API requests** and **5,200 requests for images and scripts** a second. Files average **200 KB**, so serving them from Frankfurt alone means 5,200 × 200 KB × 8 = about **8,300 Mbit/s** leaving one data centre.

A CDN edge answers about **95%** of file requests from its own copy, so only 5,200 × 0.05 = **260 a second** go back to Frankfurt. For a far visitor, a page that needs **4 round trips** waits about 4 × 150 ms = **600 ms** before any work is done; from an edge 15 ms away it is about **60 ms**.
