export type LabeledFinding={expected:boolean;surfaced:boolean;critical:boolean};
export function score(rows:LabeledFinding[]){const surfaced=rows.filter(r=>r.surfaced),correct=surfaced.filter(r=>r.expected),expectedCritical=rows.filter(r=>r.expected&&r.critical),foundCritical=expectedCritical.filter(r=>r.surfaced);return{precision:surfaced.length?correct.length/surfaced.length:1,criticalRecall:expectedCritical.length?foundCritical.length/expectedCritical.length:1}}
export function releaseGate(rows:LabeledFinding[]){const s=score(rows);return s.precision>=.8&&s.criticalRecall>=.7}
