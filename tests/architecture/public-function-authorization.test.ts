import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicFunctionPolicies } from "../../convex/publicFunctionPolicy";

// publicFunctionPolicy.ts declares an authorization for every public function, and until this test
// nothing checked a handler agreed with its declaration: deleting the role check from reviews:get
// broke one unit case and no gate. This reads each handler - following module helpers and the
// internal functions an action delegates to - and asserts the guard the declaration promises.
//
// It is a source reading, not an execution, so it proves the guard is called, not that it is
// called on every path; convex/tenantIsolation.test.ts carries the behavioural half.
const rank = { viewer: 0, developer: 1, admin: 2, owner: 3 } as const;
type Role = keyof typeof rank;

const sources = new Map<string, string>();
function source(module: string) {
  if (!sources.has(module)) {
    const raw = readFileSync(`convex/${module}.ts`, "utf8");
    // Comments name guards ("requireRepositoryRole was missing here") without calling them.
    sources.set(module, raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1"));
  }
  return sources.get(module)!;
}

function slice(code: string, start: number) {
  const next = code.slice(start + 1).search(/\n(?:export |async function |function |const \w+ = async)/);
  return code.slice(start, next === -1 ? code.length : start + 1 + next);
}

function exportedBody(module: string, name: string) {
  const code = source(module);
  const at = code.search(new RegExp(`^export const ${name}\\s*=`, "m"));
  if (at === -1) throw new Error(`${module}:${name} is declared but not exported`);
  return slice(code, at);
}

function localBody(module: string, name: string) {
  const code = source(module);
  const at = code.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\s*\\(|^(?:export )?const ${name}\\s*=\\s*async`, "m"));
  return at === -1 ? undefined : slice(code, at);
}

// Everything the handler runs before its own logic: its body, the module-local helpers it calls,
// and the internal functions it delegates to with ctx.run*, to a depth that covers every action here.
function reachable(module: string, body: string, depth = 3, seen = new Set<string>()): string {
  if (depth === 0) return body;
  let text = body;
  for (const [, name] of body.matchAll(/\b(\w+)\(ctx\b/g)) {
    const key = `${module}#${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const helper = localBody(module, name!);
    if (helper) text += "\n" + reachable(module, helper, depth - 1, seen);
  }
  for (const [, target, fn] of body.matchAll(/ctx\.run(?:Query|Mutation|Action)\(internal\.(\w+)\.(\w+)/g)) {
    const key = `${target}:${fn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    text += "\n" + reachable(target!, exportedBody(target!, fn!), depth - 1, seen);
  }
  return text;
}

const roleGuards = (text: string) =>
  [...text.matchAll(/require(?:Organization|Repository)Role\([^)]*?"(owner|admin|developer|viewer)"/g)].map(match => match[1] as Role);
// A role guard resolves the caller first, so it satisfies "signed in" too - trackerOAuth:complete
// is declared authenticated_user and in fact requires the role of whoever began the connection.
const signedIn = /requireUserId\(|getAuthUserId\(|ctx\.auth\.getUserIdentity\(|require(?:Organization|Repository)Role\(/;
const anyAuth = /require(?:UserId|OrganizationRole|RepositoryRole|RecentGitHubLogin)\(|getAuthUserId\(|ctx\.auth\./;

// Guards written inline rather than through lib/authz.ts. Each names the exact text that is the
// guard, so the exemption breaks if the check is removed rather than surviving it.
const inlineGuards: Record<string, { role: Role; guard: RegExp[] }> = {
  // Returns null instead of throwing when there is no active workspace, because the sidebar renders
  // it for a signed-in user who has not chosen one yet. Any active member may read their own receipt.
  "permissionReceipts:current": { role: "viewer", guard: [/getAuthUserId\(ctx\)/, /withIndex\("by_org_user"/, /membership\.status !== "active"\) return null/] },
};

describe("every public function enforces the authorization it declares", () => {
  for (const [key, { authorization }] of Object.entries(publicFunctionPolicies)) {
    it(`${key} is ${authorization}`, () => {
      const [module, name] = key.split(":") as [string, string];
      const text = reachable(module, exportedBody(module, name));

      if (authorization === "public_webhook") {
        expect(text, "an unauthenticated function must not depend on who is asking").not.toMatch(anyAuth);
        return;
      }
      if (authorization === "authenticated_user" || authorization === "invited_user") {
        expect(text).toMatch(signedIn);
        return;
      }

      const declared = authorization.replace("active_organization_", "").replace("_recent_auth", "") as Role;
      const inline = inlineGuards[key];
      if (inline) {
        expect(inline.role).toBe(declared);
        for (const guard of inline.guard) expect(text).toMatch(guard);
      } else {
        const roles = roleGuards(text);
        expect(roles.length, `${key} declares ${declared} but calls no role guard`).toBeGreaterThan(0);
        for (const role of roles) expect(rank[role], `${key} checks ${role}, below its declared ${declared}`).toBeGreaterThanOrEqual(rank[declared]);
      }
      if (authorization.endsWith("_recent_auth")) expect(text).toMatch(/requireRecentGitHubLogin\(/);
    });
  }

  it("keeps the inline exemptions to functions that are declared", () => {
    for (const key of Object.keys(inlineGuards)) expect(Object.keys(publicFunctionPolicies)).toContain(key);
  });
});
