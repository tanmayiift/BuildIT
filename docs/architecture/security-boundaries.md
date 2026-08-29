# BuildIT security boundaries

BuildIT separates privileges so that untrusted repository code cannot reach credentials and a model cannot decide whether its own work passed.

## Control plane

The web application and Convex functions authenticate people, authorize organizations, store metadata, schedule work, and report status. They do not execute repository code and must not store raw source or plaintext provider keys.

## Fetch stage

A short-lived worker receives a repository-scoped GitHub installation token, fetches one pinned commit, records the commit identity, removes authenticated remotes and credential helpers, revokes the token, and produces a sealed workspace. No tests run during this stage.

## Execution sandbox

A fresh isolated machine receives the sealed workspace after credential teardown is proven. It runs only an approved command plan with time, memory, output, file, and network limits. It has no GitHub token, provider key, Convex administrative key, cloud credential, or control-plane network route.

## Content broker

A separately deployed service may read one time-limited source artifact and decrypt one organization-bound model key for one provider call. It may contact only supported model providers. It cannot write to GitHub, administer Convex, or retain source.

## Delivery stage

After deterministic checks pass, a trusted worker re-checks the source PR head and mints a fresh repository-scoped token. It may create an agent branch and a stacked pull request targeting the original PR branch. It cannot merge, force-push, alter workflows, or write to the base branch.

## Decision authority

Models propose requirements, findings, explanations, and patches. Program code verifies cited evidence and computes check results, staleness, policy compliance, loop limits, and delivery eligibility. A human retains final merge authority.
