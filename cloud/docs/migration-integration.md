# Combining the account and mobile migration histories

PR41 published `0005_bright_kabuki` on main for the session/device relationship. PR42 independently used positions 0005–0007 for notification reads, the completed-task index, and generated-image gallery fields. Keep main's 0005 SQL, timestamp, and snapshot unchanged.

The mobile migrations now append as 0006–0008 with timestamps after main's 0005. They tolerate the same tables, columns, constraints, and indexes already existing because the VPS previously applied the mobile branch before the account/device migration. This lets the normal migrator upgrade a database from either branch without clearing migration records or deleting application data. Snapshot predecessor IDs follow the combined schema, including the session/device foreign key at every subsequent step.

`cloud/packages/db/src/migrations.test.ts` checks fresh installation, upgrading either branch, upgrading the VPS history containing both branches, retaining an existing account, foreign keys/indexes, and a second migration run.
