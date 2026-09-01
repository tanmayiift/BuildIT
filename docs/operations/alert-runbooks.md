# BuildIT alert runbooks

These runbooks use only global service measurements. Do not paste customer names, repository names, pull-request numbers, code, findings, prompts, logs containing user content, or credentials into an alert or incident note.

For every alert: acknowledge it, note the UTC start time, check the BuildIT dashboard, preserve the current deployment and rollback IDs, and record whether new review intake or untrusted execution was paused. Resume only after the alert condition is clear and the affected safety check passes.

## BuildITHighFailureRate

Compare actual `failed` outcomes with succeeded operation volume and p95 latency. Intentional `blocked` requests are excluded from this reliability ratio and remain visible through the dedicated safety-boundary and webhook-signature alerts. Identify the failing fixed operation label. Pause that service boundary if failures continue, then use the last Ready deployment as the rollback point.

## BuildITP95LatencyHigh

Compare queue depth, provider latency, runner latency, and artifact latency. Reduce intake before increasing timeouts. A timeout increase requires a separate reviewed change and must preserve the outer execution deadline.

## BuildITTelemetrySilent

The query always returns zero while BuildIT operation telemetry exists and one only after 15 minutes without it, avoiding a false Grafana NoData alert during healthy traffic. If it fires, probe the public web and broker health endpoints, then check the collector and the most recent BuildIT-only deployment. Treat missing telemetry as unknown health, not as success.

## BuildITCriticalBoundaryFailure

Disable the affected write or execution path. Confirm sandbox cleanup, artifact deletion, webhook rejection, loop stop, and stale-head refusal as applicable. Follow the incident-response record before restoring the path.

## BuildITQueueDepthHigh

Check worker capacity, provider limits, and oldest-job age. Stop new intake if wait time grows. Do not drop or duplicate durable jobs while reducing the queue.

## BuildITProviderFailure

Check the provider's public status and BuildIT's bounded retry counter. Disable only the failing provider route if errors continue. Do not move a customer's key to another provider.

## BuildITRunnerFailure

Disable untrusted execution. Confirm every sandbox has a terminal teardown receipt. Restore execution only after a new isolated smoke run passes with outbound network blocked.

## BuildITArtifactDeletionBacklog

Pause new artifact creation, run the deletion reconciler, and verify the global backlog returns to zero. Escalate any object that passes its retention deadline.

## BuildITWebhookSignatureSpike

Check GitHub delivery health and the secret-rotation record. Keep every invalid signature rejected. Do not weaken signature timing or replay checks to clear the alert.

## BuildITLoopGuardTrip

Confirm the run stopped at its configured round/proposal/spend bound and produced no later candidate or merge action. Inspect repeated proposals before allowing a fresh consented run.

## BuildITStaleCheck

Confirm the stale run made no write. The user may start a new review only after seeing and consenting to the current exact commit.

## BuildITBudgetExhaustionSpike

Check model routing, context size, and actual stage usage. Do not raise ceilings automatically. A user must approve each new per-review ceiling.
