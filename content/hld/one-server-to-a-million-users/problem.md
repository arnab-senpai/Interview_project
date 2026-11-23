**CityBeat** lists live music, talks and markets in one city. It started as a side project: one rented virtual machine runs the web app, the database and the image files. For two years that was plenty.

Then a local radio show started reading out "this week on CityBeat" every Friday. Daily visitors went from 20,000 to a million in three months. On Friday evenings pages now take eight seconds to load, RSVPs fail with timeouts, and twice the machine ran out of memory and every page went down until someone restarted it.

Nothing is "broken" in the code. One machine is doing four jobs, and the busiest hour of the week asks more of it than it has. This chapter grows CityBeat from one server to a design that comfortably serves a million daily users, one change at a time, and uses numbers to decide each change.
