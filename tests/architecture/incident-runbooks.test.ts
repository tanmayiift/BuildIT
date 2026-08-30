import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`docs/runbooks/${name}.md`, "utf8").toLowerCase();
describe("incident runbooks", () => {
  it("keeps provider and runner outages fail-closed and recoverable", () => {
    const provider = read("provider-outage"), runner = read("runner-outage");
    for (const term of ["kill switch", "blocked", "pinned heads", "without source"]) expect(provider).toContain(term);
    for (const term of ["disable the runner", "destroy", "platform_failed", "credential"]) expect(runner).toContain(term);
  });
  it("requires confirmed deletion and metadata-only escalation", () => {
    const deletion = read("deletion-failure");
    for (const term of ["exact artifact key", "bounded backoff", "without content", "confirms absence"]) expect(deletion).toContain(term);
  });
  it("keeps disaster recovery tenant-safe and rotates credentials", () => {
    const recovery = read("disaster-recovery"), tenant = read("tenant-incident");
    for (const term of ["encrypted", "rotate", "audit-chain", "tenant isolation", "in-flight reviews are not restored"]) expect(recovery).toContain(term);
    for (const term of ["kill switches", "metadata-only", "revoke", "affected tenants"]) expect(tenant).toContain(term);
  });
  it("never revives terminal jobs during reconciliation", () => {
    const stuck = read("stuck-job");
    for (const term of ["idempotency", "terminate", "pinned commit", "never reactivate a terminal record"]) expect(stuck).toContain(term);
  });
});
