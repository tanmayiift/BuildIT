import { createServer } from "node:http";
import { resolve } from "node:path";
import { emailCaptureHandler } from "./lib/email-capture.mjs";

const port = Number(process.env.BUILDIT_EMAIL_CAPTURE_PORT ?? "3219");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("capture_port_invalid");
const directory = resolve(".local/email-captures");
const server = createServer(emailCaptureHandler(directory));
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`BuildIT local email capture: http://127.0.0.1:${port}/capture\nCaptures: ${directory}\nNo email is sent.\n`);
});
