"use node";
import { fingerprint } from "@buildit/security";

// The one identity a finding keeps outside BuildIT. The analysis stage stores it on the finding, and
// the inline comment carries it in its marker, so a person resolving that comment's thread on GitHub
// can be matched back to the finding they were looking at.
//
// The marker used to carry the model's own id ("F1"), which is neither a document id nor this
// fingerprint, so findingFeedbackData.record matched nothing and every resolved thread on every
// review was dropped. Both callers now derive it here: two copies of one rule drift.
export function findingFingerprint(item: { id: string; path: string; startLine: number; endLine: number }, key: Buffer) {
  return fingerprint(`${item.id}\0${item.path}\0${item.startLine}\0${item.endLine}`, key);
}
