import {createHmac} from "node:crypto";
import {describe,expect,it} from "vitest";
import {authorizeTrigger,canCommitSensitiveWrite,deliverStackedPr,DeliveryLedger,trustedConfiguration,verifyWebhook} from "../src/index.js";
describe("GitHub boundary",()=>{
 it("verifies raw webhook bytes",()=>{const body=Buffer.from('{"x":1}'),sig="sha256="+createHmac("sha256","s").update(body).digest("hex");expect(verifyWebhook(body,sig,"s")).toBe(true);expect(verifyWebhook(Buffer.from("changed"),sig,"s")).toBe(false)});
 it("deduplicates deliveries",()=>{const l=new DeliveryLedger();expect(l.accept("d")).toBe(true);expect(l.accept("d")).toBe(false)});
 it("rejects bots, edits, and weak autofix actors",()=>{expect(authorizeTrigger({deliveryId:"1",action:"created",senderType:"Bot",body:"@buildit review",permission:"admin"}).accepted).toBe(false);expect(authorizeTrigger({deliveryId:"2",action:"created",senderType:"User",body:"@buildit autofix",permission:"triage"}).accepted).toBe(false)});
 it("never trusts head configuration",()=>expect(()=>trustedConfiguration({defaultBranch:"main",headSha:"a",trustedSha:"a",protectionVerified:true,explicitlyApproved:false})).toThrow());
 it("guards commit-sensitive writes",()=>expect(canCommitSensitiveWrite("a","b")).toBe(false));
 it("delivers only a fully validated stacked PR",async()=>{const calls:string[]=[];const client={createBranch:async()=>{calls.push("branch")},createPullRequest:async(input:{base:string})=>{calls.push(input.base);return{number:2,url:"https://example/pr/2"}}};await expect(deliverStackedPr(client,{jobId:"j",prNumber:1,sourceBranch:"feature",pinnedHead:"a",currentHead:"a",candidateSha:"b",allRequiredChecksPassed:true})).resolves.toMatchObject({number:2});expect(calls).toEqual(["branch","feature"]);await expect(deliverStackedPr(client,{jobId:"j",prNumber:1,sourceBranch:"feature",pinnedHead:"a",currentHead:"c",candidateSha:"b",allRequiredChecksPassed:true})).rejects.toThrow("stale_head")});
});
