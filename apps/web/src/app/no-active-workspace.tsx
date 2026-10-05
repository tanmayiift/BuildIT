import { EmptyState } from "./empty-state";

// Five surfaces read repositoryConnections:current and then waited on a second query that stays
// skipped for as long as no workspace is active - so /metrics, /usage, /audit, /notifications and
// the setup permission receipt each showed a spinner that could never resolve, with nothing to
// click. That is the state every invited member lands in, and the state anyone lands in after being
// removed from the workspace they had selected. The review queue was fixed once on its own; this is
// the same terminal branch in one place, so the next surface cannot be left behind again.
export function NoActiveWorkspace({ heading, detail }: { heading: string; detail: string }) {
  return <EmptyState size="live" mark="GH" title={heading} detail={<>You are signed in, but no workspace is active yet. {detail}</>} actions={<>
    <a className="button" href="/setup/install">Choose repository access</a>
    <a className="button secondary" href="/account">Accept a workspace invitation</a>
  </>} />;
}
