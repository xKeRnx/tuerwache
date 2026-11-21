# Security, backups and upgrades

## Export source code for GitHub

Source belongs in Git; Ring sessions, faces and keys do not. The exporter copies allowlisted source into a new empty destination. It omits data, backups, APKs, weights, native builds, node_modules and Git metadata.

```powershell
node scripts/prepare-repository.mjs --destination H:\Tuerwache-GitHub
```

Review embedded credentials and mobile project IDs before pushing. Install dependencies and models after cloning. The export includes the [license text](../LICENSE.md) for original code.

For a private rehearsal, use an empty private repository and replace the account and repository below. For a public release, follow [GitHub, licensing and business model](github.en.md).

```bash
git add .
git diff --cached --stat
git commit -m "Initial private version"
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-PRIVATE-REPO.git
git push -u origin main
```

These are instructions only; nothing was uploaded. Keep SaaS and self-hosting in separate private repositories.

## External access

Default: loopback, external access disabled. For home/cloud, configure HTTPS origin, allowed hosts, exact proxy IP and MFA for every user. Cloud needs a separate AUTH_ENCRYPTION_KEY outside the data volume. Then select deployment mode and enable access. Full proxy setup is in deploy/README.md.

Do not forward public traffic directly to Node or trust arbitrary forwarding headers. VPN access also requires correct configuration. Independently review public authentication before serving customers. Perfect security is not promised.

## Retention and protection

Operations → Retention has independent local age/GiB and cloud age/GiB rules (cloud quota 0 = unlimited), disabled by default. Preview saved rules before enabling automatic checks every five minutes. Protected clips are excluded from both rules; active processing is skipped. Protected footage can prevent the configured quota from being met.

Cloud-only playback is authenticated and proxied through the server; buckets stay private. Reading/deleting requires the original endpoint, region, bucket and credentials. Expired recordings remain as events. Cloud quota uses tracked clip sizes; unrelated bucket objects are not managed. Retention is not a backup.

## Encrypted backups

Operations → Backups creates a `.twbackup` protected with scrypt and AES-256-GCM. Use at least 16 characters and keep the passphrase separately. Archives include users/MFA, the effective encryption key, Ring session, settings, events, face templates, reviews and optional videos. Browser/phone sessions are excluded. Software, Python, model weights and `.env` are excluded; protect environment configuration and EXPO_ACCESS_TOKEN separately.

Optional scheduled backups store a sealed passphrase locally. Their retention count applies only to scheduled archives; manual backups are kept. Download a copy to a separate device. Archives contain sensitive data and must not be published.

## Verified restore / migration to Linux or Pi

1. Install a compatible Türwache version and Python/AI dependencies on the destination. Stop the old server; never share one Ring session/data directory between active instances.
2. Copy the archive to `backups/snapshots/UUID.twbackup` (or BACKUP_DIRECTORY), verify it through the web backup page and note the verification ID. Verification does not change live data.
3. Stop the destination server. From its project directory, dry-run first, then explicitly apply:

```bash
node scripts/restore.mjs --verification VERIFICATION-UUID
node scripts/restore.mjs --verification VERIFICATION-UUID --apply
```

Restore checks all files/hashes, creates and checks a working copy beside the destination directory, moves previous data to `.tuerwache-previous-UUID`, then activates the prepared directory. Activation failure rolls back the previous directory. Previous data is retained; remove it manually only after acceptance. Allow enough space for the archive, verification and working copies.

Clip paths are rewritten for DATA_DIRECTORY. AUTH_ENCRYPTION_KEY, if configured, must match the imported key. Browser/phone sessions must sign in again. Remote access stays off; retention, scheduled backups and Discord operations alerts are disabled for review before re-enabling.

Fresh Docker deployments use `/app/data/state` plus a separate backup volume. A volume root cannot be replaced: back up older `/app/data` installations before explicitly migrating to a data subdirectory. Run restore offline with the same mounts/environment. Pi migration transfers data, not platform-specific binaries. Large VLMs are best hosted on a separate machine.

## Health and durable retries

Operations shows Ring/event connectivity, offline cameras, free space, slow jobs, delivery failures and the retry queue. Optional neutral Discord health alerts are throttled to every 30 minutes and disabled by default. Event silence is not an alarm by default; a quiet scene can be normal.

New failures in local AI, descriptions and uploads can be retried with durable bounded attempts. Paused cameras and removed local footage are skipped. Ambiguous Discord/push delivery is not automatically resent. Expo receipts confirm handoff to Apple/Google, not display to a person. Invalid device tokens are removed. A phone can trigger a test only for its own session.

## AI quality

Review a clip description as correct/incorrect/uncertain, with an optional correction. Reviews belong to that description version and do not replace it. Under AI → AI quality, compare configured models using the same up to six frames. Cloud comparisons require explicit consent to transmit images, consume the daily limit and may incur fees. Comparisons send no notifications and preserve the original description. Comparison results can also be rated. No automatic training occurs.

## Upgrade

Review changes, back up, stop, update source, rerun installer with appropriate AI option, start and verify a new audio/video event. Roll back old source and its matching data backup together. Never use one JSON store from multiple server processes.

Still pending: physical Linux/Pi acceptance of these new features, signed iOS installation and physical-device push acceptance. Independent security review/dependency maintenance before wider public use. This guide is not a completed audit.


## Mobile test build dependencies

Expo Doctor with Expo 58.0.26 passes 20/20 compatibility checks; this is not a security audit. `npm audit` still reports 42 affected mobile SDK/tooling dependency entries (40 high, 2 moderate), traced to two glob/regex advisories concerning picomatch and minimatch. This is not 42 independently validated attack paths. No forced SDK downgrade was applied. Review advisories and compatible updates before store/customer release; the APK remains a test build. Server dependencies are a separate tree.
