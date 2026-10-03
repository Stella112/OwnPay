import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = process.env.OWNPAY_BUILD_DIR || ".next";
if (!/^\.next(?:-[a-zA-Z0-9-]+)?$/.test(output)) throw new Error("Invalid OwnPay build directory.");
const staticSource = path.join(root, output, "static");
const standaloneRoot = path.join(root, output, "standalone");

if (!fs.existsSync(staticSource) || !fs.existsSync(standaloneRoot)) {
  throw new Error("Next standalone output is incomplete; expected .next/static and .next/standalone");
}

fs.cpSync(staticSource, path.join(standaloneRoot, output, "static"), { recursive: true });
const publicSource = path.join(root, "public");
if (fs.existsSync(publicSource)) {
  fs.cpSync(publicSource, path.join(standaloneRoot, "public"), { recursive: true });
}

console.log("Prepared Next standalone public and static assets.");
