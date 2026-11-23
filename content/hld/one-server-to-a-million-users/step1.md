Today everything runs on one machine: the web app, the database and the image files. Every request, from a listing page to a logo, lands on the same CPU, memory and disk.

At the Friday peak that is about 1,000 requests a second. A single general-purpose server running an app and a database side by side handles a few hundred to about a thousand simple requests a second before it slows down, so CityBeat is at the edge. The figure turns the server red because one instance cannot keep up at the 60% target utilisation we plan for.
