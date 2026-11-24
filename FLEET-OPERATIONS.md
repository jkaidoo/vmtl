# Fleet operations update

Restart the application to apply PostgreSQL migration 008 and install the two new roles. SQLite upgrades itself on startup. Assign roles from Users.

- **University Transport Officer:** fleet-only dashboard, all OUs, vehicle and driver management. Account provisioning remains on Users.
- **Schedule Transport Officer:** transport officer capabilities plus university-wide fleet and IDL event scheduling. Create an event, find available fleet for a time window, pair a driver with a vehicle, then track fuel and other costs for each schedule. Scheduled trips can be rescheduled or cancelled. A schedule with recorded fuel keeps its original vehicle and driver; create a new schedule to change that pairing.
- **Fuel, maintenance and fleet records:** fuel station (KNUST JP / Other + name) and fuel type are dropdowns; the maintenance provider is a dropdown (KNUST Maintenance / Toyota Ghana / Other + name) with an optional image or PDF receipt. Vehicles and drivers take a photo shown as a thumbnail in their lists, and drivers a licence photo. If an upload fails the record is still saved; Save again retries the upload.
- **App Owner → Dropdowns:** edit business choices; workflow states, organisation types and vehicle types can be relabelled but their keys are protected because code (including the trip-progress animation) depends on them. The Other choice must stay on stations and providers. Roles, users, vehicles and OUs are managed on their dedicated pages. Protocol/provider choices remain tied to supported integrations.
- **App Owner → File Server:** database, server folder/mounted share, S3-compatible or Supabase Storage. Save runs a write/read/delete connection test. Default maximum is 5 MB, configurable up to 8 MB; daily allowance defaults to 200 MB per user. Photos are resized and re-encoded in the browser. PDF and image maintenance receipts are supported; licence and profile uploads accept images.

Remote storage credentials require DATABASE_PROFILE_ENCRYPTION_KEY or SESSION_SECRET. Use a private bucket. Files are served through authenticated, scoped API endpoints. Keep the encryption key stable and back it up separately. Database backups include file records, database-resident bytes, events, schedules and expenses; external files require storage-provider backups too. Older files keep their original storage location when settings change.

Local verification: `npm test`. PostgreSQL integration: PowerShell `$env:VMTL_TEST_FLEET_PG='1'; node --test test/fleetOperations.test.js`. Live S3/Supabase connectivity is tested using File Server after credentials are configured.

Review follow-up: licence files require driver-management permission or the linked driver's own account. Driver login provisioning requires user-management permission; linked privileged accounts are managed through Users. Fleet detail/history endpoints enforce OU scope. Fuel purchases now have Edit/Remove controls, preserve schedule assignments, and rebuild dependent economy readings after changes. Verified backups from before migration 008 remain readable/restorable; cleanup removes event-schedule dependencies and releases unused fleet resources. Scheduled/in-progress fleet entries cannot be removed until their trips are cancelled or completed.

Scheduling follow-up: drivers are notified when an IDL schedule assigns them, and again when it is rescheduled, moved to another driver or cancelled (new `trip_rescheduled` and `trip_cancelled` templates on Email / SMS). IDL trips and requests are numbered `IDL-TRIP-00001` / `IDL-REQ-00001`. Every scheduling endpoint enforces OU scope, so a role given `schedule.events` on RBAC without `fleet.global` stays within its own units. Cancelled schedules accept no new expenses or fuel; existing linked fuel can still be corrected. Vehicle thumbnails link straight to the stored photo.

# Fleet operations extensions

Restart the application to apply PostgreSQL migration 009 (SQLite upgrades itself on startup). The new fleet capabilities — **Manage incidents** (`incidents.manage`), **Manage driver duty & roster** (`duty.manage`) and **Manage parts & tyres** (`parts.manage`) — are seeded onto the Transport/Admin Officer, Approver and University/Schedule Transport Officer roles, and held in full by the System Administrator. Route history, geofences and the cost/emissions/performance insight pages reuse existing capabilities (`trips.operate` / `requests.assign`, `analytics.view`). Assign roles from Users / RBAC.

- **Work orders (`maintenance.manage`):** plan preventive maintenance with a title, type, priority and due date. A work order moves open → scheduled → in progress → awaiting parts → completed. Completing one with a completed date records it in the vehicle's maintenance history (and updates the service markers) and links the two, so the cost is never counted twice. The page shows open, overdue and awaiting-parts counts; numbered `WO-00001`.
- **Incidents (`incidents.manage`):** report accidents, breakdowns, damage, theft, vandalism or fire against a vehicle (optionally a driver and trip), with severity, a description, injuries, third-party details, estimated cost, photos and a location (text plus an optional pin). Each moves through reported → assessing → claim filed → resolved → closed, capturing the claim reference and resolution. Major / total-loss incidents notify oversight. Numbered `INC-00001`; org-scoped by the vehicle's unit.
- **Route history & geofences:** while a driver runs a trip with location sharing on, fixes are stored as a breadcrumb trail (throttled) in addition to the single latest position. Open the trip to replay the route on a map. Geofences are circular inclusion (stay inside) or exclusion (keep out) zones; each fix is checked against the active zones in the vehicle's scope, crossings are recorded, and a breach alerts oversight. Manage zones on **Geofences** — under the System section, App Owner only for now (shareable with roles or people on Owner page access).
- **Driver duty & roster (`duty.manage`):** plan shifts, standby, leave and training per driver with start/end times on a weekly roster. Overlapping working duties (shift/standby) for the same driver are rejected. Duty hours are totalled per driver for fatigue/overtime oversight. This is an **optional module, off by default**: the App Owner turns it on at **System controls → Feature flags → Fleet modules**. While off, the Driver duty menu item, page and `/duty` API are hidden/refused for everyone (the `duty.manage` capability still exists but surfaces nothing until the module is on).
- **Parts & tyres (`parts.manage`):** an inventory of tyres, parts, fluids and batteries with on-hand quantity against a reorder level. Stock movements — receive, fit to a vehicle (recording position and odometer), or adjust — change the quantity and keep a history. Items at or below their reorder level are flagged low stock.
- **Insights (`analytics.view`):** **Costs** attributes running costs (fuel, maintenance, work orders, incidents) to the owning org unit for chargeback and divides by completed-trip distance for cost-per-km (no budgets, actuals only). **Emissions** estimates CO₂ from litres × fuel-type factor and shows per-vehicle efficiency (L/100km, km/L). **Performance** summarises requester trip ratings per driver and lists recent feedback, low scores flagged.
- **Booking calendar (`requests.create`):** a month view of how busy the fleet is each day (scheduled/in-progress trips against the scoped fleet size), so requesters pick a quiet day before raising a request. **Trip ratings:** after a trip is completed its requester rates it 1–5 (with optional punctuality and vehicle-condition scores and a comment); ratings ≤2 are flagged and notify oversight.

Local verification: `npm test`. All new endpoints are org-scoped to the viewer's visible subtree and recorded in the audit log.

## Upload validation

| Flow | Server endpoint and destination |
| --- | --- |
| Vehicle photo, driver photo and licence, incident photo, maintenance receipt, and external travel letter | `POST /api/fleet-files/:type/:id/:kind` → configured database, server folder, S3-compatible storage, or Supabase Storage |
| Work-order receipt (API only) | Same attachment endpoint with `work_order` and `receipt` |
| Transport schedule CSV, picked, dropped or pasted | `POST /api/ts/events/:id/import-schedule` → schedule assignments in the database |
| Profile avatar and administrator-set avatar (API only) | `POST /api/me/avatar` and `POST /api/users` or `PUT /api/users/:id` → users table |

All browser file bytes go through Express. Storage writes use the exact buffer
the server validated and a new object key. Files are available through the
existing scoped read routes after metadata is committed. OneDrive backups and
File Server moves transfer existing server data. Directory photo sync fetches
images on the server through its existing bounded photo normalizer.

Fleet checks cover JPEG (including JPG, JPE and JFIF), PNG and WebP, with PDF
accepted for receipts and letters. The File Server limit (1–8 MB, 5 MB by
default) applies to both the selected file and the transmitted attachment.
CSV uses a 1 MB limit, strict UTF-8 and the existing comma-delimited schedule
columns with quote and row-shape checks. Avatar APIs accept JPEG, PNG, WebP
and GIF data URLs within their existing encoded-length limits. Earlier saved
avatars are retained.

The shared binary check reads up to 32 bytes at the front and 1 KiB at the
end. It checks format markers, basic structure such as WebP container
length, and end markers where applicable. It does not fully parse image
chunks or validate all PDF objects and cross-references. Browser image
resizing also decodes the image. These checks do not scan for malware. CSV
reads the whole bounded file because it has no binary signature.

Browser uploads use binary bodies to support measurable transfer progress.
Fleet validation reads the File Server settings on selection and at receipt.
There are no added storage reads, separate verification requests, or
staging objects. An attachment retry with the same operation ID and bytes
can reuse the accepted attachment. CSV retries skip drivers already assigned
to the event.
