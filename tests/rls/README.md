# Database access tests

Apply the checked-in migration to the dedicated wafer-inspection project first.
Run `owner-policies.sql` through an administrator SQL connection or the connected
Supabase SQL tool. The script creates fresh test identities, switches between
user A, user B, anonymous Auth, and the unauthenticated `anon` role, then rolls
everything back. It never reads account passwords or API keys.

The final result reports **68 assertions**. A failing assertion raises
an exception. The temporary test users and rows must not be committed.

Coverage includes owner SELECT/INSERT/UPDATE restrictions and ownership transfer,
DELETE denial, isolation of each PC's reference settings, capture/event retry keys,
cross-owner event references, immutable inspection image ownership, private image
bucket restrictions, image folder/owner checks, and anonymous access denial.
The dedicated project's `storage.objects` must have no permissive DELETE/ALL
policy. The hosted Supabase direct-metadata-delete protection stays enabled;
the test expects its permission denial instead of disabling that protection.
Both checked-in migrations are required: delayed older settings and inspection
snapshots must preserve newer rows, and ordinary later updates must still work.
Settings `updated_at` is maintained monotonically by the server.

SQL role simulation does not verify email/password login, API configuration,
Storage's JWT owner assignment, object bytes, or HTTP authorization. Separate
real Auth/REST/Storage tests with temporary users are required before claiming
those paths pass. No real camera, Uno, PLC, or mechanism is exercised here.

Migration creation note: the Supabase CLI was unavailable in the editing runtime,
so the file name uses the runtime's UTC timestamp. The SQL is version-controlled;
apply it once through the connected migration tool rather than pasting parts.
