# Sync

Sync moves a server between machines (your PC, a test VPS, a recording VPS) in any direction. Each push
is a snapshot in one shared, encrypted repository, normally on a hub you run on one of your VPSes; any
machine can pull any snapshot. Only changed data is uploaded after the first push.

The engine is [restic](https://restic.net) 0.19.1. The app downloads it on first use from the restic
GitHub release and checks it against the release's published SHA-256 before running it
(`src/main/sync/pin.ts`).

## Set up the hub once (recommended)

One of your own VPSes holds the snapshots for every machine. It runs restic's
[rest-server](https://github.com/restic/rest-server) 0.14.0, downloaded on first use and checked against
its published SHA-256, as a background process the app starts and stops.

On the VPS that should hold the history:

1. Settings → Sync → **Hub on this machine** → Set up hub.
2. Check the address other machines use (the VPS's public IP or a DNS name), the port (8000 or the next
   free one) and the data folder. Append-only is on by default: machines can add snapshots but never
   delete or change them.
3. **Open port…** adds a Windows Firewall rule for that port after Windows' administrator prompt. If the
   VPS provider has its own firewall (a security group or panel firewall), open the same TCP port there.
4. **Connection code** copies the code for the other machines.

On every other machine: Settings → Sync → **Paste code**. Then turn on sync per server, or use Clone
from remote on the Overview page.

How it is secured: the hub creates its own certificate authority and an HTTPS certificate for its
addresses. The connection code carries that CA certificate, so clients trust only this hub, not any
server that answers on the address. The hub login is a generated password (bcrypt in its htpasswd
file). Snapshot data is encrypted by restic with the repository password before it leaves a machine.
Hub passwords and the CA key are sealed with Windows (Electron `safeStorage`); rest-server's own TLS
key sits in `%APPDATA%\FiveM Server Manager\sync-hub` because rest-server has to read it.

**The hub's disk holds all the history.** If that disk or VPS is lost, so are the snapshots. Keep a
second copy, for example a scheduled copy of the data folder to another drive, another VPS or cloud
storage. Restic repositories can be copied as plain folders while no push is running.

Before every operation the app makes one quick HTTPS request to the hub, so a wrong certificate, a wrong
password or a closed port shows a clear error in seconds instead of restic retrying for minutes.

## Other remotes

**Cloudflare R2.** In the Cloudflare dashboard:

1. R2 → Create bucket, for example `fivem-sync`. Location: automatic.
2. R2 → Manage API tokens → Create API token. Permission: **Object Read & Write**, limited to that
   bucket. Copy the **Access Key ID** and **Secret Access Key** (shown once).
3. Note the **Account ID** (R2 overview page, right side).
4. In the app: Settings → Sync → Add remote → Cloudflare R2. Paste the account id, bucket and both keys.
   Leave the repository password empty to generate one.

Other machines: Settings → Sync → **Connection code** on the first machine, then **Paste code** on the
other. The code contains the keys and the repository password, so share it only between your own machines.

Keys and the password are stored encrypted with Windows (Electron `safeStorage`) in
`%APPDATA%\FiveM Server Manager\sync-remotes.json`. They reach restic through environment variables only,
never on a command line or in a log.

**Lose the repository password and the snapshots cannot be read.** Keep a copy somewhere safe (the
connection code includes it).

S3-compatible storage, an SFTP host (key-based login; uses Windows' built-in OpenSSH) or a plain folder
(a second drive, a NAS share) work the same way.

## Use it

- Server → **Sync** tab → Turn on sync. Pick the remote; leave the sync id empty for a new one.
- **Push** uploads a snapshot tagged with this machine's name. Optional database dump (mariadb-dump).
- **Pull** asks first, stops the server, saves a restore point, makes the folder match the newest push,
  optionally imports the database, puts back this machine's port, license key and
  `mysql_connection_string`, downloads the FXServer build if missing, and restarts the server.
- **Clone from remote** (Overview) creates a new server from a synced one.
- **History** lists every push and every restore point; any of them can be restored.
- If both this copy and the remote changed since this machine last synced, Push and Pull stop and list
  the changed files on both sides first.

The ignore list (`.fxsyncignore`, synced with the server) leaves out `cache/`, logs, crash dumps and
temporary files by default. Ignored files are never uploaded and never deleted by a pull.

## What a VPS needs

- Windows (the app is Windows only), with the app installed.
- The hub VPS: one inbound TCP port (8000 by default) open in Windows Firewall (the app adds the rule
  after asking) and in the provider's firewall, if it has one. Disk room for every server's history.
- Every machine: outbound HTTPS to `github.com` once, to download restic (and rest-server on the hub).
  With R2/S3 remotes instead, outbound HTTPS to the storage endpoint.
- SFTP remotes need outbound SSH to the storage host and a key in `%USERPROFILE%\.ssh` or ssh-agent.
- Disk on each machine: room for the server plus restic's local cache
  (`%APPDATA%\FiveM Server Manager\sync-cache`, a few hundred MB).

## Notes

- Cancel stops a push right away. The next push skips what restic had already saved and indexed on the
  remote. A short push cancelled part-way uploads its new data again.
- Snapshots are never deleted by the app. Old ones can be pruned with restic directly; with an
  append-only hub, run restic on the hub against its data folder, since remote deletes are refused.
- Tests: `npm test` (unit), `npm run test:e2e` (end to end through a folder remote with a 1.5 GB fake
  server, `FSM_E2E_GB` changes the size, and through a local rest-server hub with TLS and append-only).
