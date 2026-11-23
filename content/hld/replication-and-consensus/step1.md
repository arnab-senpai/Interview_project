Start with one database server. Every read and every write goes to it: 5,000 queries a second against a plan of 1,800.

Its disk is also the only copy of the data. Backups help you recover, but restoring one takes hours, and everything written since the backup is lost.
