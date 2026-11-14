# Fleet operations update

Restart the application to apply PostgreSQL migration 008 and install the two new roles. SQLite upgrades itself on startup. Assign roles from Users.

- **University Transport Officer:** fleet-only dashboard, all OUs, vehicle and driver management. Account provisioning remains on Users.
- **Schedule Transport Officer:** transport officer capabilities plus university-wide fleet and IDL event scheduling. Create an event, find available fleet for a time window, pair a driver with a vehicle, then track fuel and other costs for each schedule. Scheduled trips can be rescheduled or cancelled. A schedule with recorded fuel keeps its original vehicle and driver; create a new schedule to change that pairing.
- **App Owner → Dropdowns:** edit business choices; workflow states and organisation type keys are protected because code depends on them. Roles, users, vehicles and OUs are managed on their dedicated pages. Protocol/provider choices remain tied to supported integrations.
- **App Owner → File Server:** database, server folder/mounted share, S3-compatible or Supabase Storage. Save runs a write/read/delete connection test. Default maximum is 5 MB, configurable up to 8 MB; daily allowance defaults to 200 MB per user. Photos are resized and re-encoded in the browser. PDF and image maintenance receipts are supported; licence and profile uploads accept images.

Remote storage credentials require DATABASE_PROFILE_ENCRYPTION_KEY or SESSION_SECRET. Use a private bucket. Files are served through authenticated, scoped API endpoints. Keep the encryption key stable and back it up separately. Database backups include file records, database-resident bytes, events, schedules and expenses; external files require storage-provider backups too. Older files keep their original storage location when settings change.

Local verification: `npm test`. PostgreSQL integration: PowerShell `$env:VMTL_TEST_FLEET_PG='1'; node --test test/fleetOperations.test.js`. Live S3/Supabase connectivity is tested using File Server after credentials are configured.

Review follow-up: licence files require driver-management permission or the linked driver's own account. Driver login provisioning requires user-management permission; linked privileged accounts are managed through Users. Fleet detail/history endpoints enforce OU scope. Fuel purchases now have Edit/Remove controls, preserve schedule assignments, and rebuild dependent economy readings after changes. Verified backups from before migration 008 remain readable/restorable; cleanup removes event-schedule dependencies and releases unused fleet resources. Scheduled/in-progress fleet entries cannot be removed until their trips are cancelled or completed.
