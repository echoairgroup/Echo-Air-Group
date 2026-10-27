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

test("pilot, contact and manager forms submit through the first-party API with privacy acknowledgement", () => {
  const script = read("script.js");
  const join = read("join.html");
  const contact = read("contact.html");
  const manager = read("manager.html");
  assert.match(script, /fetch\(ECHO_API_BASE \+ '\/applications'/);
  assert.match(script, /fetch\(ECHO_API_BASE \+ '\/contact'/);
  assert.match(script, /fetch\(ECHO_API_BASE \+ '\/manager-applications'/);
  assert.match(script, /addEventListener\('submit', submitApplication\)/);
  assert.match(script, /addEventListener\('submit', submitContactMessage\)/);
  assert.match(script, /addEventListener\('submit', submitManagerApplication\)/);
  assert.match(join, /id="pilotApplicationForm"/);
  assert.match(join, /id="privacyAcknowledged"[\s\S]{0,200}required/);
  assert.match(contact, /id="contactForm"/);
  assert.match(contact, /id="contactPrivacyAcknowledged"[\s\S]{0,200}required/);
  assert.match(manager, /id="managerApplicationForm"/);
  assert.match(manager, /id="managerPrivacyAcknowledged"[\s\S]{0,200}required/);
  for (const html of [join, contact, manager]) assert.doesNotMatch(html, /formsubmit\.co/);
});

test("pilot application API validates inputs and keeps its review endpoints admin-only", () => {
  const server = read("server.js");
  assert.match(server, /CREATE TABLE IF NOT EXISTS pilot_applications/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS pilot_application_events/);
  assert.match(server, /"\/api\/applications",[\s\S]{0,80}applicationRateLimit/);
  assert.match(server, /"\/api\/admin\/applications",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/applications\/:id",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/applications\/:id\/events",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /await client\.query\("BEGIN"\)/);
  assert.match(server, /await client\.query\("COMMIT"\)/);
});

test("contact and manager submissions have protected review APIs and an audit trail", () => {
  const server = read("server.js");
  assert.match(server, /CREATE TABLE IF NOT EXISTS external_submissions/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS external_submission_events/);
  assert.match(server, /"\/api\/contact",[\s\S]{0,80}contactRateLimit/);
  assert.match(server, /"\/api\/manager-applications",[\s\S]{0,100}managerApplicationRateLimit/);
  assert.match(server, /"\/api\/admin\/submissions",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/submissions\/:id",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /"\/api\/admin\/submissions\/:id\/events",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/);
  assert.match(server, /DISCORD_APPLICATIONS_CHANNEL_ID/);
  assert.match(server, /allowedMentions: \{ parse: \[\] \}/);
});

test("administration screens escape user-supplied values and use the bearer token", () => {
  const pilots = read("applications-admin.html");
  const inbox = read("submissions-admin.html");
  assert.match(pilots, /escapeHtml\(app\.email\)/);
  assert.match(pilots, /escapeHtml\(app\.reason/);
  assert.match(pilots, /headers\.Authorization = 'Bearer ' \+ token/);
  assert.match(inbox, /escapeHtml\(item\.email\)/);
  assert.match(inbox, /const escapeHtml = \(value\)/);
  assert.match(inbox, /detail\('Motivation', details\.motivation/);
  assert.match(inbox, /headers\.Authorization = 'Bearer ' \+ token/);
});

test("required public pages have titles and responsive viewport tags", () => {
  const htmlFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html"));
  assert.ok(htmlFiles.length >= 10);
  for (const file of htmlFiles) {
    const source = read(file);
    assert.match(source, /<title\b[^>]*>[^<]+<\/title>/i, file + " title");
    assert.match(source, /name=["']viewport["']/i, file + " viewport");
    assert.doesNotMatch(source, /http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api/i, file + " localhost API URL");
  }
});
