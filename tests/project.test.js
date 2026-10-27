const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("API authentication has no predictable fallback secret", () => {
  const server = read("server.js");
  assert.doesNotMatch(server, /CHANGE_THIS_SECRET/);
  assert.match(server, /const JWT_SECRET = process\.env\.JWT_SECRET \|\| "";/);
});

test("global sync and database diagnostics require explicit admin authorization", () => {
  const server = read("server.js");
  assert.match(server, /"\/api\/sync\/all",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/database-stats",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
});

test("deployed account dashboard uses the shared hosted API base", () => {
  const page = read("Server.html");
  assert.match(page, /https:\/\/echo-air-group-api\.onrender\.com\/api/);
  assert.doesNotMatch(page, /http:\/\/localhost:3000\/api/);
  assert.match(page, /API \+ "\/ranking"/);
});

test("pilot application form submits to the API and acknowledges the privacy notice", () => {
  const script = read("script.js");
  const join = read("join.html");
  assert.match(script, /fetch\(ECHO_API_BASE \+ '\/applications'/);
  assert.match(script, /addEventListener\('submit', submitApplication\)/);
  assert.match(join, /id="pilotApplicationForm"/);
  assert.match(join, /id="privacyAcknowledged"[\s\S]{0,200}required/);
  assert.doesNotMatch(join, /formsubmit\.co/);
});

test("pilot application API validates inputs and keeps review endpoints admin-only", () => {
  const server = read("server.js");
  assert.match(server, /CREATE TABLE IF NOT EXISTS pilot_applications/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS pilot_application_events/);
  assert.match(server, /"\/api\/applications",[\s\S]{0,80}applicationRateLimit/);
  assert.match(server, /"\/api\/admin\/applications",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/applications\/:id",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /await client\.query\("BEGIN"\)/);
  assert.match(server, /await client\.query\("COMMIT"\)/);
});

test("recruitment dashboard escapes applicant-provided fields", () => {
  const page = read("applications-admin.html");
  assert.match(page, /escapeHtml\(app\.email\)/);
  assert.match(page, /escapeHtml\(app\.reason/);
  assert.match(page, /Authorization: 'Bearer ' \+ token/);
});

test("required public pages have titles and responsive viewport tags", () => {
  const htmlFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html"));
  assert.ok(htmlFiles.length >= 10);
  for (const file of htmlFiles) {
    const source = read(file);
    assert.match(source, /<title\b[^>]*>[^<]+<\/title>/i, file + " title");
    assert.match(source, /name=["']viewport["']/i, file + " viewport");
  }
});
