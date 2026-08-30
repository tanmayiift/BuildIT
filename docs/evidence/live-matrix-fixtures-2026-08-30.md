# Live review matrix fixtures — 2026-08-30

These repositories contain synthetic test code, not customer source.

- Public review input: `tanmayiift/buildit-public-fixture#2`, head `682805eaf9a3e813d400ba1fac7e3a0799f63f42`.
- Private review input: `tanmayiift/buildit-private-fixture#1`, head `e4394730d18c9f19e1ab434fe0514410e78a0cdd`.

Each PR has a known regression, a deterministic failing test, and acceptance criteria written before the model run. Both are open and require a human merge.

The packaged CLI read the public PR at its exact head and returned the stable `not_started` status with exit code 3. No review command was posted while the matching broker and Convex production release was blocked.
