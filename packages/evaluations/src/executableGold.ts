export type ExecutableFixtureGold={id:string;classification:"introduced"|"unchanged_pass";defectFamily:"requirement_boundary"|"authorization_bypass"|"false_positive_trap"};
export const executableFixtureGold:ReadonlyArray<ExecutableFixtureGold>=Object.freeze([
  {id:"exec-case-01",classification:"introduced",defectFamily:"requirement_boundary"},
  {id:"exec-case-02",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
  {id:"exec-case-03",classification:"introduced",defectFamily:"requirement_boundary"},
  {id:"exec-case-04",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
  {id:"exec-case-05",classification:"introduced",defectFamily:"requirement_boundary"},
  {id:"exec-case-06",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
  {id:"exec-case-07",classification:"introduced",defectFamily:"authorization_bypass"},
  {id:"exec-case-08",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
  {id:"exec-case-09",classification:"introduced",defectFamily:"authorization_bypass"},
  {id:"exec-case-10",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
  {id:"exec-case-11",classification:"introduced",defectFamily:"authorization_bypass"},
  {id:"exec-case-12",classification:"unchanged_pass",defectFamily:"false_positive_trap"},
]);
