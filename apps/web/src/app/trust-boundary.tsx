"use client";
import { useId, useState } from "react";

// /data-handling was 387 words of prose and not one thing to operate, on the page whose whole
// subject is a shape: what sits where, what crosses between them, and what each side refuses. A
// boundary is a picture. Reading ten paragraphs and assembling the picture yourself is work the
// page should have done.
//
// Nothing here is softer than the prose it replaces - every stage still names its region, its
// retention and its refusal. They are behind a selection rather than stacked on top of each other,
// because a reader wants one of them at a time and had to read all ten to find it.

type Place = {
  id: string; label: string; region: string;
  holds: string; refuses: string;
  box: { x: number; y: number; width: number; height: number };
};

const places: Place[] = [
  {
    id: "github", label: "GitHub", region: "Your repositories",
    holds: "Your source. BuildIT reads only the repositories you selected when you installed the GitHub App, and public and private repositories use the same installation boundary.",
    refuses: "It may maintain one BuildIT check and one summary comment on the reviewed commit, and open a separate stacked pull request after Autofix consent. It has no merge authority and does not edit workflows or repository settings.",
    box: { x: 8, y: 118, width: 132, height: 64 },
  },
  {
    id: "buildit", label: "BuildIT", region: "Vercel",
    holds: "The web app and an isolated credential broker. Your model key is sent to the broker for provider validation and AWS KMS encryption; BuildIT returns masked metadata and stores no plaintext key.",
    refuses: "Product logs must not contain source or raw provider keys. Infrastructure providers may retain request metadata such as time, IP address and browser details under their own terms.",
    box: { x: 196, y: 118, width: 150, height: 64 },
  },
  {
    id: "convex", label: "Convex", region: "Ireland",
    holds: "Durable application state: references, decisions, audit events and review metadata with no source in it.",
    refuses: "No plaintext source and no raw provider key is written here. An owner or admin can rotate or revoke a stored credential, which destroys the envelope rather than flagging the row.",
    box: { x: 430, y: 20, width: 282, height: 52 },
  },
  {
    id: "artifacts", label: "Artifact store", region: "AWS Ireland",
    holds: "Checked-out code and command output, encrypted and bound to one organization, repository, review and stage.",
    refuses: "The configured maximum source retention is seven days and your repository policy may be shorter. Deletion is confirmed by reading the key back from storage, not assumed.",
    box: { x: 430, y: 82, width: 282, height: 52 },
  },
  {
    id: "sandbox", label: "Isolated sandbox", region: "Paris",
    holds: "Install, test, lint, typecheck and the pinned scanners, as real processes on a throwaway machine.",
    refuses: "Network access is denied after the fixed install step, and the machine is destroyed when the run ends.",
    box: { x: 430, y: 144, width: 282, height: 52 },
  },
  {
    id: "provider", label: "Your model provider", region: "Your key",
    holds: "When you start AI analysis, the selected review prompt and bounded evidence go to the provider you chose, authenticated with your own key.",
    refuses: "Deterministic checks run with no model key at all, and unrelated repositories are never sent.",
    box: { x: 430, y: 206, width: 282, height: 52 },
  },
];

// Right-hand destinations, in the order they are drawn, so the elbow from BuildIT reaches each one.
const destinations = places.filter(place => place.box.x === 430);

export function TrustBoundary() {
  const markerId = useId();
  const [activeId, setActiveId] = useState(places[0]!.id);
  const active = places.find(place => place.id === activeId)!;
  return <div className="boundary-map">
    {/* The flow is 720 units wide and its labels stop being readable below about 620 real pixels,
        so a narrow screen scrolls the figure rather than shrinking the text past legibility. A
        scrollable region that cannot be focused cannot be scrolled from a keyboard at all, which is
        WCAG 2.1.1 - so the container takes focus itself and names what it is. */}
    <div className="boundary-figure-scroll" tabIndex={0} role="group" aria-label="Trust boundary diagram, scrollable">
    <svg viewBox="0 0 720 268" className="boundary-figure" role="img"
      aria-label="Your repositories on GitHub reach BuildIT on Vercel, which writes to Convex in Ireland, an encrypted artifact store in AWS Ireland, an isolated sandbox in Paris, and the model provider whose key you supplied. BuildIT writes one check, one comment and an optional stacked pull request back to GitHub.">
      <defs>
        <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--line-strong)" />
        </marker>
      </defs>
      <g stroke="var(--line-strong)" strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`}>
        <path d="M140 150 H186" />
        {destinations.map(place => <path key={place.id} d={`M346 150 H390 V${place.box.y + place.box.height / 2} H420`} />)}
        <path d="M271 182 V214 H74 V186" strokeDasharray="4 4" />
      </g>
      <text x="173" y="232" textAnchor="middle" fontSize="9" fill="var(--muted)">one check · one comment · optional stacked PR</text>
      {places.map(place => {
        const selected = place.id === activeId;
        return <g key={place.id}>
          <rect x={place.box.x} y={place.box.y} width={place.box.width} height={place.box.height} rx="7"
            fill={selected ? "var(--navy-soft)" : "var(--surface)"}
            stroke={selected ? "var(--navy)" : "var(--line-strong)"} strokeWidth={selected ? 2.5 : 1} />
          <text x={place.box.x + 14} y={place.box.y + place.box.height / 2 - 2} fontSize="13" fontWeight="750" fill="var(--ink)">{place.label}</text>
          <text x={place.box.x + 14} y={place.box.y + place.box.height / 2 + 14} fontSize="10" fill="var(--muted)">{place.region}</text>
        </g>;
      })}
    </svg>
    </div>
    <div className="boundary-choices">
      {places.map(place => (
        <button key={place.id} className="button secondary" type="button" aria-pressed={place.id === activeId}
          onClick={() => setActiveId(place.id)}>{place.label}</button>
      ))}
    </div>
    <div className="boundary-detail" aria-live="polite">
      <p className="eyebrow">{active.label} · {active.region}</p>
      <dl>
        <div><dt>What it holds</dt><dd>{active.holds}</dd></div>
        <div><dt>What it refuses</dt><dd>{active.refuses}</dd></div>
      </dl>
    </div>
  </div>;
}
