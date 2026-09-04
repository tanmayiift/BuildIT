import { workspaceSections } from "./app/workspace-sections";
import { publicAssets } from "./public-assets";
import { publicRoutes } from "./app/public-routes";

const setupSteps = ["install", "repository", "model", "health"];
// public-routes.ts says this file reads it. It did not - the marketing paths were retyped here,
// so adding a public page in one place and forgetting the other builds, renders locally, and then
// 404s at the Edge in production. Derived now, so that cannot happen a second time.
const publicSegments = publicRoutes.filter(route => route !== "/").map(route => route.slice(1));
// Single-segment routes that are neither public nor a workspace section.
const gatedSegments = ["reviews", "account", "setup", "__nonce-probe"];

export function known(pathname: string) {
  if (pathname === "/" || pathname === "") return true;
  if ((publicAssets as readonly string[]).includes(pathname)) return true;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    return publicSegments.includes(segments[0]!) || gatedSegments.includes(segments[0]!)
      || (workspaceSections as readonly string[]).includes(segments[0]!);
  }
  if (segments[0] === "setup") return segments.length === 2 && setupSteps.includes(segments[1]!);
  if (segments[0] === "reviews") return segments.length === 2;
  return true;
}
