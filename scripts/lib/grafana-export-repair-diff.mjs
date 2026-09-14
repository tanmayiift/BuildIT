// Compare native UI exports without a token, network request, or normalization of rule settings.
const receiver = "BuildIT alerts (Tanmay)";
const missing = { absent: true };
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const escapePath = key => String(key).replaceAll("~", "~0").replaceAll("/", "~1");

function shapeProblems(document, side) {
  const problems = [];
  if (document?.apiVersion !== 1 || !Array.isArray(document.groups) || document.groups.length !== 1) {
    problems.push(`${side}: expected one native export group and apiVersion 1`);
    return problems;
  }
  const group = document.groups[0];
  if (group.folder !== "buildit" || group.name !== "buildit-release" || group.orgId !== 1) problems.push(`${side}: current BuildIT group identity differs`);
  if (!Array.isArray(group.rules) || group.rules.length !== 14) problems.push(`${side}: expected 14 current rules`);
  if (Array.isArray(group.rules)) {
    if (new Set(group.rules.map(rule => rule.uid)).size !== group.rules.length) problems.push(`${side}: duplicate rule UID`);
    if (group.rules.some(rule => typeof rule.uid !== "string" || !rule.uid || typeof rule.title !== "string" || !rule.title.startsWith("BuildIT"))) {
      problems.push(`${side}: missing or unexpected rule identity`);
    }
  }
  return problems;
}

// Pair unchanged UIDs so a removed/replaced rule cannot hide inside an array reorder.
// Rule order is still reported separately; JSON object property order is immaterial.
function keyed(document) {
  if (!Array.isArray(document?.groups)) return document;
  return { ...document, groups: document.groups.map(group => !Array.isArray(group?.rules) ? group : {
    ...group, ruleOrder: group.rules.map(rule => rule.uid),
    rules: Object.fromEntries(group.rules.map(rule => [String(rule.uid), rule])),
  }) };
}

export function compareGrafanaRepairExports(before, after) {
  const structuralFailures = [...shapeProblems(before, "before"), ...shapeProblems(after, "after")];
  const actualDifferences = [];
  let visited = 0;
  function diff(left, right, path = "", depth = 0) {
    if (++visited > 50_000 || depth > 80) throw new Error("buildit_grafana_export_comparison_limit");
    if (Object.is(left, right)) return;
    if ((isObject(left) || left === undefined) && (isObject(right) || right === undefined)) {
      const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
      for (const key of [...keys].sort()) diff(left?.[key], right?.[key], `${path}/${escapePath(key)}`, depth + 1);
      // Distinguish addition/removal of an empty object from no field at all.
      if (keys.size === 0 && (left === undefined || right === undefined)) actualDifferences.push({ path, before: left ?? missing, after: right ?? missing });
      return;
    }
    if (Array.isArray(left) && Array.isArray(right) && !path.endsWith("/ruleOrder")) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) diff(left[index], right[index], `${path}/${index}`, depth + 1);
      return;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) actualDifferences.push({ path, before: left === undefined ? missing : left, after: right === undefined ? missing : right });
  }
  diff(keyed(before), keyed(after));
  const beforeRules = Array.isArray(before?.groups?.[0]?.rules) ? before.groups[0].rules : [];
  const afterRules = Array.isArray(after?.groups?.[0]?.rules) ? after.groups[0].rules : [];
  const expected = new Map(beforeRules.flatMap(rule => [
    [`/groups/0/rules/${escapePath(rule.uid)}/execErrState`, { from: ["OK", "Error"], to: "Error" }],
    [`/groups/0/rules/${escapePath(rule.uid)}/notification_settings/receiver`, { from: [missing, receiver], to: receiver }],
  ]));
  for (const difference of actualDifferences) {
    const allowed = expected.get(difference.path);
    difference.expected = Boolean(allowed && difference.after === allowed.to && allowed.from.some(value => JSON.stringify(value) === JSON.stringify(difference.before)));
  }
  const requirementFailures = beforeRules.flatMap(rule => {
    const saved = afterRules.filter(candidate => candidate.uid === rule.uid);
    if (saved.length !== 1) return [{ uid: rule.uid, title: rule.title, requirement: "exactly one original rule UID" }];
    return [
      ["execErrState", saved[0].execErrState === "Error"],
      ["notification_settings.receiver", saved[0].notification_settings?.receiver === receiver],
      ["noDataState", saved[0].noDataState === "OK"],
    ].filter(([, satisfied]) => !satisfied).map(([requirement]) => ({ uid: rule.uid, title: rule.title, requirement }));
  });
  const unexpectedDifferences = actualDifferences.filter(difference => !difference.expected);
  return {
    readOnly: true, evidenceKind: "native_ui_export_diff", ruleCount: afterRules.length,
    repairMatches: structuralFailures.length === 0 && unexpectedDifferences.length === 0 && requirementFailures.length === 0,
    structuralFailures, requirementFailures, actualDifferences, unexpectedDifferences,
    folderUIDsVerified: false, fullStackInventoryVerified: false, deliveryTested: false,
    limits: "Only these two exported current groups are compared. Cosmetic changes are reported; no live firing or receiver delivery is inferred.",
  };
}
