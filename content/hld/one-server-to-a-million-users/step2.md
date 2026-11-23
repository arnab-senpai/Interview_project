The first change costs almost nothing in code: move the database to its own machine. The app server now spends its CPU on rendering pages, and the database gets its own memory for caching rows and its own disk.

Splitting them also lets each side grow in its own way. App servers can be copied freely; the database is the part that holds state, so it is scaled with more care later in this chapter.
