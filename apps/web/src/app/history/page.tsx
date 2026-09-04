import { LiveHistory } from "../live-history";

// What BuildIT has actually done on your repositories, and what it cost. The metrics page counts
// events; this answers the question a lead actually asks - is this thing earning its place, and
// which pull request should I look at first.
export default function History() {
  return <div className="content">
    <div className="page-heading">
      <div>
        <p className="eyebrow">Review history</p>
        <h1 className="title">What BuildIT found, and what it cost</h1>
        <p className="lede">Every review on your connected repositories, ordered by what BuildIT actually found rather than by a risk score it would have to invent.</p>
      </div>
    </div>
    <LiveHistory />
  </div>;
}
