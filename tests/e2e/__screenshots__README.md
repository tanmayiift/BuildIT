# What the release screenshots prove

`repositories-connected-{desktop,mobile}.png` are rendered from `connectedDesignFixture` in
`apps/web/src/app/live-connections.tsx` — a hardcoded client object reachable only under
`NEXT_PUBLIC_BUILDIT_E2E=1` with `?tour=1&fixture=connected`.

They are **layout and accessibility evidence for the connected state**. They are not evidence that
a real signed-in customer sees that state, because they never execute
`repositoryConnections:current`.

The backend half of that claim is `convex/connectedJourney.test.ts`: a signed-in identity against
a seeded workspace, driving the real query through every state the UI branches on — connected,
installation required, installation unavailable, no repositories selected, and signed out.

Do not cite these images as proof of connected-state behaviour. Cite them for layout.
