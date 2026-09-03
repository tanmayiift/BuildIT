# Track record

The measured figures the features and trust pages render live in
`apps/web/src/app/track-record.json`, inside the web app because that is the deployment root and a
file outside it cannot be resolved at build time.

Regenerate from production with:

```
pnpm evidence:track-record
```

It reads every review, counts repositories, decisive verdicts and the run since the last platform
failure, and writes the file. Nothing about the record is typed by hand — a number in prose goes
stale the moment the thing it describes moves, and `tests/architecture/track-record.test.ts` fails
if one is ever typed back into the copy.
