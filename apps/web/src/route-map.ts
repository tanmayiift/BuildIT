import { workspaceSections } from "./app/workspace-sections";
import { publicAssets } from "./public-assets";

const setupSteps = ["install", "repository", "model", "health"];

export function known(pathname: string) {
  if (pathname === "/" || pathname === "") return true;
  if ((publicAssets as readonly string[]).includes(pathname)) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    return ["reviews", "account", "sign-in", "data-handling", "pricing", "sandbox", "setup", "__nonce-probe"].includes(segments[0]!)
      || (workspaceSections as readonly string[]).includes(segments[0]!);
  }
  if (segments[0] === "setup") return segments.length === 2 && setupSteps.includes(segments[1]!);
  if (segments[0] === "reviews") return segments.length === 2;
  return true;
}
