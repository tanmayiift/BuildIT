export type LocalEmailCaptureConfig = { backendUrl: string; captureUrl: string; webOrigin: string };
export function loopbackHttpUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
export function localEmailCaptureConfig(env: Record<string, string | undefined>): LocalEmailCaptureConfig | null {
  if (env.BUILDIT_EMAIL_DELIVERY_MODE !== "local_capture" || env.VERCEL || env.VERCEL_ENV) return null;
  const backend = loopbackHttpUrl(env.CONVEX_CLOUD_URL), capture = loopbackHttpUrl(env.BUILDIT_EMAIL_CAPTURE_URL), web = loopbackHttpUrl(env.BUILDIT_WEB_ORIGIN ?? "http://127.0.0.1:3000");
  if (!backend || backend.pathname !== "/" || !capture || capture.pathname !== "/capture" || !web || web.pathname !== "/") return null;
  return { backendUrl: backend.origin, captureUrl: capture.toString(), webOrigin: web.origin };
}
