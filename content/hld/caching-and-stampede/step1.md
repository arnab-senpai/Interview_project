Every page read goes straight to Postgres. The app pods are stateless and easy to add, but there is one database, and at 20,500 queries a second it is several times over what one server can serve.

This is the baseline to improve on, and the numbers tell you where: the database, not the app tier.
