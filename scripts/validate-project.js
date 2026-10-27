#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const report = (condition, message) => {
  if (!condition) failures.push(message);
};

const htmlFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html"));
report(htmlFiles.length >= 10, "Expected the complete Echo Air Group HTML page set.");

for (const file of htmlFiles) {
  const source = read(file);
  report(/<title\b[^>]*>[^<]+<\/title>/i.test(source), `${file} is missing a document title.`);
  report(/name=["']viewport["']/i.test(source), `${file} is missing a responsive viewport meta tag.`);
  report(!/http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api/i.test(source), `${file} contains a localhost API URL.`);
}

const server = read("server.js");
report(!server.includes('"CHANGE_THIS_SECRET"'), "The predictable JWT fallback secret must not be present.");
report(server.includes('const JWT_SECRET = process.env.JWT_SECRET || "";'), "JWT_SECRET should come only from the environment.");
report(/function requireAdmin\(/.test(server), "Admin authorization middleware is missing.");
report(/"\/api\/sync\/all",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Global sync is not protected by the admin guard.");
report(/"\/api\/admin\/database-stats",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Database stats are not protected by the admin guard.");
report(/express\.json\(\{\s*limit:\s*["']256kb["']\s*\}\)/.test(server), "JSON request payload size should be bounded.");
report(/registerRateLimit/.test(server) && /loginRateLimit/.test(server), "Authentication rate limits are missing.");

const accountPage = read("Server.html");
report(accountPage.includes("https://echo-air-group-api.onrender.com/api"), "Account dashboard must have a deployed API fallback.");
report(!accountPage.includes("http://localhost:3000/api"), "Account dashboard contains a localhost API fallback.");
report(accountPage.includes("escapeHtml(pilot.name)"), "Pilot names must be escaped before HTML rendering.");
report(accountPage.includes('API + "/ranking"'), "Leaderboard should use the shared API base URL.");

const appScript = read("script.js");
report(!/function submitApplication\(e\)\s*\{\s*e\.preventDefault\(\)/.test(appScript), "Application submission must not be cancelled before FormSubmit receives it.");

const workflowsDir = path.join(root, ".github", "workflows");
if (fs.existsSync(workflowsDir)) {
  for (const file of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const source = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    report(!/\bgit push\b/i.test(source), `${file} should not push self-generated changes directly to the repository.`);
  }
}

if (failures.length) {
  console.error("Echo Air Group validation failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Echo Air Group validation passed (${htmlFiles.length} HTML pages checked).`);
}
