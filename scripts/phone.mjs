#!/usr/bin/env node
// `npm run phone`: get the newest Stash onto the phone app in one go (Mac; see MOBILE.md).
//
//  1. Remembers the signing Team (and bundle id) you picked in Xcode, then undoes the two files that
//     change on their own (Xcode's project file, npm's lock file) so `git pull` can't get stuck.
//  2. Downloads the latest code and installs anything new.
//  3. Puts your Team and bundle id back, so you don't have to pick them again in Xcode.
//  4. Finds the Mac's Wi-Fi address, saves it in .env.local, and points the app at it.
// Then: restart `npm run dev -- -H 0.0.0.0` and press ▶ in Xcode.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PBX = "ios/App/App.xcodeproj/project.pbxproj";
const DEFAULT_BUNDLE_ID = "pro.stashinc.app";
const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const quiet = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);

// Signing settings Xcode wrote into the project when a Team was picked.
export function readSigning(pbx) {
  const team = /DEVELOPMENT_TEAM = ([^;]+);/.exec(pbx)?.[1] ?? null;
  const bundleId = /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/.exec(pbx)?.[1] ?? null;
  return { team, bundleId };
}

// Put them back into the app target's Debug and Release settings (next to its bundle id).
export function applySigning(pbx, { team, bundleId }) {
  let out = pbx;
  if (bundleId && bundleId !== DEFAULT_BUNDLE_ID) {
    out = out.replaceAll(`PRODUCT_BUNDLE_IDENTIFIER = ${DEFAULT_BUNDLE_ID};`, `PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`);
  }
  if (team && !out.includes("DEVELOPMENT_TEAM =")) {
    out = out.replace(/(\n(\t+))(PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)/g, `$1DEVELOPMENT_TEAM = ${team};$1$3`);
  }
  return out;
}

function main() {
  if (!existsSync(PBX)) {
    console.error("Run this from the Stash folder (cd ~/Desktop/stash-test).");
    process.exit(1);
  }

  step("Remembering your Xcode signing Team");
  const signing = readSigning(readFileSync(PBX, "utf8"));
  console.log(signing.team ? `  Team ${signing.team}, bundle id ${signing.bundleId}` : "  (no Team picked yet, pick it in Xcode once)");

  step("Undoing the files that change by themselves");
  sh(`git checkout -- package-lock.json ${PBX}`);

  step("Downloading the latest Stash");
  sh("git pull");

  step("Installing anything new");
  sh("npm install --no-audit --no-fund");

  if (signing.team || signing.bundleId) {
    step("Putting your Team back");
    writeFileSync(PBX, applySigning(readFileSync(PBX, "utf8"), signing));
  }

  step("Finding your Mac's Wi-Fi address");
  let ip = "";
  try {
    ip = quiet("ipconfig getifaddr en0");
  } catch {
    // not on Wi-Fi (en0), fall back to what .env.local already has
  }
  const envPath = ".env.local";
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (!ip) ip = /^STASH_DEV_HOST=(.+)$/m.exec(env)?.[1]?.trim() ?? "";
  if (!ip) {
    console.error("  Couldn't find it. Connect to Wi-Fi and run npm run phone again.");
    process.exit(1);
  }
  env = /^STASH_DEV_HOST=.*$/m.test(env)
    ? env.replace(/^STASH_DEV_HOST=.*$/m, `STASH_DEV_HOST=${ip}`)
    : `${env}${env && !env.endsWith("\n") ? "\n" : ""}STASH_DEV_HOST=${ip}\n`;
  writeFileSync(envPath, env);
  console.log(`  ${ip}`);

  step("Updating the iPhone app");
  sh(`CAP_SERVER_URL=http://${ip}:3000 npx cap sync ios`);

  console.log(`\n\x1b[32m✓ Done.\x1b[0m Next:
  1. In the tab running Stash: Control + C, then  npm run dev -- -H 0.0.0.0
  2. In Xcode: press ▶  (open it with  npx cap open ios  if it's closed)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
