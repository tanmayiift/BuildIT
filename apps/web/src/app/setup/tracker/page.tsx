import { TrackerOAuthSetup } from "../../tracker-oauth";
export const metadata = { title: "Connect issue tracker · BuildIT", referrer: "no-referrer" as const, robots: { index: false, follow: false } };
export default function TrackerCallbackPage() { return <TrackerOAuthSetup />; }
