// Applies only to the ignored copy served by the strict loopback audit harness.
export function localAuditWebPolicy(source) {
  const connection = '"connect-src \'self\' https://*.convex.cloud wss://*.convex.cloud https://buildit-content-broker.vercel.app"';
  if (source.split(connection).length !== 2) throw new Error("local_audit_csp_shape_changed");
  return source.replace(connection, connection.slice(0, -1) + ' http://127.0.0.1:3218 ws://127.0.0.1:3218"');
}
