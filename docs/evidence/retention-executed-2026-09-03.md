# Retention deletion, executed in production — 2026-09-03

Until today this was BuildIT's one untested promise about user data. The privacy copy said source
evidence is deleted; the cron was scheduled correctly and had **never run once**, because no
artifact had reached its expiry yet:

```
artifacts=406  deleted=0  attempted=0  terminal=0
oldest expiry: 2026-09-04T12:28
```

## What was proved

Review `nx70epatks3vymv52xzqsjxsgx8dppvd` (`tanmayiift/BuildIT#31`) held five artifacts, including
two repository snapshots totalling ~434 KB of real source:

```
j5715veahr233kcpwp5bcr6wd58dqgvg  repository_snapshot  257284
j578grrtvkwzy9s4veg7y5ke4h8dqm7f  repository_snapshot  186167
j576bzes4sn6d8mev5r7rjz2s98dp9wk  command_output         1386
j577r4h3ts6zkk6273mqa1mw498dqftv  prompt_trace           6471
j570ehnjhvszdgp7vxjzn6589x8dqnqw  review_message         1380
```

An erasure request brought their expiry forward, and the real cleanup worker ran:

```
internal.artifactCleanupData.eraseReviewEvidence  ->  { "expired": 5 }
internal.artifactCleanupWorker.cleanup            ->  { "claimed": 5, "deleted": 5, "failed": 0 }
```

Afterwards every row carries a `deletedAt`, one second apart — one full broker round trip each:

```
j5715veahr233kcpwp5bcr6wd58dqgvg  deletedAt=2026-09-03T16:41:15.505Z  err=none
j578grrtvkwzy9s4veg7y5ke4h8dqm7f  deletedAt=2026-09-03T16:41:16.437Z  err=none
j576bzes4sn6d8mev5r7rjz2s98dp9wk  deletedAt=2026-09-03T16:41:17.416Z  err=none
j577r4h3ts6zkk6273mqa1mw498dqftv  deletedAt=2026-09-03T16:41:18.353Z  err=none
j570ehnjhvszdgp7vxjzn6589x8dqnqw  deletedAt=2026-09-03T16:41:19.286Z  err=none

deployment total: artifacts=406  deleted=5  attempted=5  terminal=0
```

## Why `deletedAt` is proof the object left storage, not an assertion

`deletedAt` cannot be written unless S3 confirmed absence. `ArtifactBroker.delete`
(`packages/broker/src/artifacts.ts:90`) issues `DeleteObjectCommand`, then reads the same key back
with `HeadObjectCommand`, and throws `artifact_delete_unconfirmed` unless that read fails with
NotFound. `artifactCleanupWorker.cleanup` calls `completeDeletion` only on a broker `200`. So the
verification is done by the production code path, on the real bucket — five times, here.

The comment on that method predates this run and states the reason plainly: reporting deletion
without a read-back "asserts the retention promise rather than confirming it".

## What was simulated, stated plainly

**Only the clock.** The expiry was brought forward deliberately rather than waited out. Everything
else was real: the lease, the signed single-use delete grant, the broker call, the S3 delete, the
read-back, and the database transition. Nothing about the deletion path was stubbed or mocked.

## The capability this added

`internal.artifactCleanupData.eraseReviewEvidence` did not exist before today, which is why the
path had never run. Retention was the only thing that ever deleted evidence, so "we delete your
source" meant "within 24 hours" and an owner asking for it gone sooner had nothing to invoke —
neither did `docs/runbooks/deletion-failure.md`.

It moves the expiry and stops. It deliberately does **not** mark rows deleted, because only the
confirmed-delete path may do that; a mutation that flipped the flag itself would turn the promise
back into an assertion. Covered by `convex/artifactErasure.test.ts`, including that specific
guarantee.

## Still to observe

The unforced cron firing on the real clock after 2026-09-04T12:28, when the remaining 401
artifacts reach their own expiry. This run proves the path works; that one will prove the schedule
fires it without being asked. Appended here when observed.
