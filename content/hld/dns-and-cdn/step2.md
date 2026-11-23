Images and scripts are the same for everyone, so they can be copied close to visitors. A **CDN** runs servers ("edges") in dozens of cities. Point a name such as static.citybeat.com at the CDN; its DNS answers with an edge near the visitor.

The edge checks its copy. On a hit it answers at once, about 15 ms away. On a miss it fetches the file from CityBeat (the **origin**), keeps it, and answers. This is a pull CDN: it fills itself on demand. With 95% of file requests answered at the edge, Frankfurt sees 5,500 page requests plus 260 file misses.
