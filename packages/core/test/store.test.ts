import {describe,expect,it} from "vitest";import {Store} from "../src/store.js";
const owner={organizationId:"a",role:"owner" as const};const review={id:"r",organizationId:"a",repositoryId:"repo",prNumber:1,headSha:"abcdef1",status:"queued" as const,isStale:false,artifactIds:[],createdAt:1};
describe("tenant-safe store",()=>{it("blocks another tenant",()=>{const s=new Store();s.createReview(owner,review);expect(()=>s.getReview({organizationId:"b",role:"owner"},"r")).toThrow("forbidden")});it("deduplicates active heads",()=>{const s=new Store();s.createReview(owner,review);expect(()=>s.createReview(owner,{...review,id:"r2"})).toThrow("active_review_exists")});it("marks an artifact deleted once it is past its expiry, and leaves the rest alone",()=>{
 const s=new Store();
 s.addArtifact(owner,{id:"past",organizationId:"a",reviewId:"r",storageKey:"x",expiresAt:1});
 s.addArtifact(owner,{id:"due",organizationId:"a",reviewId:"r",storageKey:"y",expiresAt:2});
 s.addArtifact(owner,{id:"future",organizationId:"a",reviewId:"r",storageKey:"z",expiresAt:3});
 s.expire(2);
 expect(s.getArtifact(owner,"past").deletedAt).toBe(2);
 expect(s.getArtifact(owner,"due").deletedAt).toBe(2);
 expect(s.getArtifact(owner,"future").deletedAt).toBeUndefined();
})
it("keeps one tenant's artifacts out of another's reach",()=>{
 const s=new Store();
 s.addArtifact(owner,{id:"a",organizationId:"a",reviewId:"r",storageKey:"x",expiresAt:1});
 expect(()=>s.getArtifact({organizationId:"b",role:"owner"},"a")).toThrow("forbidden");
 expect(()=>s.addArtifact({organizationId:"b",role:"owner"},{id:"b",organizationId:"a",reviewId:"r",storageKey:"x",expiresAt:1})).toThrow("forbidden");
})});
