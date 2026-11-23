Start with the design you could build in an afternoon. The article page calls a counter API. The API runs `UPDATE counts SET views = views + 1 WHERE article_id = ?` and reads the new value back from one database table.

Say it is deliberately simple. It is correct, it is easy to reason about, and it gives you something concrete to put numbers on. Interviewers would rather see a simple design that you then improve than a complicated one you can't justify.
