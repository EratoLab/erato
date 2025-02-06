## DB / Schema management with sqitch

All our migrations are prefixed with a 4 digit number (starting with 0000).

### Creating a new migration

```bash
./new_migration.sh --description "Add a new column to the users table"
```

### Migrating against a live cluster for development

To manually migrate a live cluster in our development environents, add a target to the sqitch file in your home directory (`~/.sqitch/sqitch.conf`) that is outside of your version control.

The database to target here should likely be `app`, and due to quirks of Kubernetes port-forwarding use `?sslmode=disable`.