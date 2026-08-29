import {describe,expect,it} from "vitest";
import {githubConclusion,reviewRecord,terminalStatuses} from "../src/index.js";
describe("lifecycle contracts",()=>{
 it("maps human action stops to action_required",()=>{for(const s of ["blocked","cancelled","budget_exhausted"] as const)expect(githubConclusion(s,"advisory")).toBe("action_required")});
 it("fails closed only for platform failure",()=>{expect(githubConclusion("platform_failed","advisory")).toBe("neutral");expect(githubConclusion("platform_failed","fail_closed")).toBe("failure")});
 it("requires an explicit termination bound",()=>{expect(()=>reviewRecord.parse({id:"r",organizationId:"o",repositoryId:"x",prNumber:1,headSha:"abcdef1",status:"failed_after_bounds",isStale:false,completedRoundCount:3,patchAttemptCount:3})).toThrow()});
 it("caps rounds and attempts",()=>{expect(()=>reviewRecord.parse({id:"r",organizationId:"o",repositoryId:"x",prNumber:1,headSha:"abcdef1",status:"checks_passed",isStale:false,completedRoundCount:4,patchAttemptCount:7})).toThrow()});
 it("keeps terminal values explicit",()=>expect(terminalStatuses.has("checks_passed")).toBe(true));
});
