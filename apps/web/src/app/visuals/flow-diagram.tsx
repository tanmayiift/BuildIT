// A short left-to-right sequence: where something goes and what happens to it at each stop. Used
// where a setup step asks the reader to hand something over (repository access, a model key), so
// the path is a picture before it is a paragraph. Every step restates a guarantee the page already
// makes in prose; the diagram adds no claim of its own.
export type FlowStep = { label: string; detail: string };

export function FlowDiagram({ label, steps, never }: { label: string; steps: readonly FlowStep[]; never?: string }) {
  return (
    <figure className="flow-diagram" aria-label={label}>
      <ol>
        {steps.map((step, index) => (
          <li key={step.label}>
            <span className="flow-step-index" aria-hidden="true">{index + 1}</span>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>
      {never ? <figcaption><strong>Never:</strong> {never}</figcaption> : null}
    </figure>
  );
}

export const repositoryAccessFlow: readonly FlowStep[] = [
  { label: "Your repositories", detail: "Only the ones you select in GitHub. The rest stay invisible." },
  { label: "Read at one commit", detail: "The pull request, its diff, checks and linked issues, pinned to the exact head commit." },
  { label: "Checked in a sandbox", detail: "Your tests and the pinned scanners run on a throwaway machine with no network after install." },
  { label: "Written back", detail: "One check and one summary comment, and a stacked fix PR only after you consent." },
];

export const modelKeyFlow: readonly FlowStep[] = [
  { label: "Your key", detail: "Sent from this browser straight to BuildIT's separate credential broker." },
  { label: "Validated", detail: "Checked with your provider before anything is saved." },
  { label: "Encrypted", detail: "With AWS KMS in Ireland. Never returned to the browser or stored as plaintext." },
  { label: "Used per review", detail: "Only when AI analysis starts, within the cost limit you approve. Every call shows on Usage." },
];
