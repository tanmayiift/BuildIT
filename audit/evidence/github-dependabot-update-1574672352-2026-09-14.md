# BuildIT Dependabot update review — 2026-09-14

The failed dynamic Dependabot run `34811667916` was update `1574672352` for
`@vitest/mocker` on `main`. GitHub's update page says Dependabot could not move the dependency
from the 3.2.7 line to the earliest fixed 4.1.11 line. The repository's current local patch has
already upgraded Vitest and its lockfile to 4.1.11; the current whole-tree secret scan and the
latest main Build and Security workflows pass.

Gmail contained eight GitHub notification conversations matching the BuildIT/Dependabot search,
but only one was for `tanmayiift/BuildIT`; the other seven were for the unrelated
`tanmayiift/buildit-demo-express` repository. BuildIT's weekly grouped routine policy and security
alerts are useful. Keeping routine update pull requests capped and grouped reduces noise; turning
off security alerts or automatic security fixes would remove protection and is not recommended.

The historical failure remains visible in GitHub because the run is immutable; it does not describe
the current source state.
