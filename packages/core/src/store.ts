import type {ReviewStatus,TerminationBound} from "@buildit/contracts";
export type Role="owner"|"admin"|"developer"|"viewer";
export type Review={id:string;organizationId:string;repositoryId:string;prNumber:number;headSha:string;status:ReviewStatus;isStale:boolean;terminationBound?:TerminationBound;artifactIds:string[];createdAt:number};
export type Event={reviewId:string;sequence:number;type:string;messageArtifactId?:string;createdAt:number};
export type Artifact={id:string;organizationId:string;reviewId:string;storageKey:string;expiresAt:number;deletedAt?:number};
export class Store{
 #reviews=new Map<string,Review>();#events:Event[]=[];#artifacts=new Map<string,Artifact>();
 createReview(actor:{organizationId:string;role:Role},review:Review){authorize(actor,review.organizationId,"developer");if([...this.#reviews.values()].some(r=>r.repositoryId===review.repositoryId&&r.prNumber===review.prNumber&&r.headSha===review.headSha&&!isTerminal(r.status)))throw new Error("active_review_exists");this.#reviews.set(review.id,structuredClone(review));return review}
 getReview(actor:{organizationId:string;role:Role},id:string){const r=this.#reviews.get(id);if(!r)throw new Error("not_found");authorize(actor,r.organizationId,"viewer");return structuredClone(r)}
 appendEvent(actor:{organizationId:string;role:Role},event:Event){const r=this.getReview(actor,event.reviewId);authorize(actor,r.organizationId,"developer");const expected=this.#events.filter(e=>e.reviewId===event.reviewId).length+1;if(event.sequence!==expected)throw new Error("bad_sequence");this.#events.push(structuredClone(event))}
 addArtifact(actor:{organizationId:string;role:Role},artifact:Artifact){authorize(actor,artifact.organizationId,"developer");this.#artifacts.set(artifact.id,structuredClone(artifact))}
 getArtifact(actor:{organizationId:string;role:Role},id:string){const a=this.#artifacts.get(id);if(!a)throw new Error("not_found");authorize(actor,a.organizationId,"viewer");return structuredClone(a)}
 expire(now:number){for(const [id,a] of this.#artifacts)if(a.expiresAt<=now)this.#artifacts.set(id,{...a,deletedAt:now})}
}
const rank:Record<Role,number>={viewer:0,developer:1,admin:2,owner:3};
export function authorize(actor:{organizationId:string;role:Role},organizationId:string,minimum:Role){if(actor.organizationId!==organizationId||rank[actor.role]<rank[minimum])throw new Error("forbidden")}
function isTerminal(s:ReviewStatus){return ["checks_passed","changes_requested","inconclusive","delivered","failed_after_bounds","cancelled","budget_exhausted","platform_failed"].includes(s)}
