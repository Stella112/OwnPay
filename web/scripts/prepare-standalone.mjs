import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const staticSource = path.join(root, ".next", "static");
const standaloneRoot = path.join(root, ".next", "standalone");

if (!fs.existsSync(staticSource) || !fs.existsSync(standaloneRoot)) {
  throw new Error("Next standalone output is incomplete; expected .next/static and .next/standalone");
}

fs.cpSync(staticSource, path.join(standaloneRoot, ".next", "static"), { recursive: true });
const publicSource = path.join(root, "public");
if (fs.existsSync(publicSource)) {
  fs.cpSync(publicSource, path.join(standaloneRoot, "public"), { recursive: true });
}

console.log("Prepared Next standalone public and static assets.");
