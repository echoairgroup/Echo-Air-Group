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

test("application form helper preserves native form submission", () => {
  const script = read("script.js");
  assert.doesNotMatch(script, /function submitApplication\(e\)\s*\{\s*e\.preventDefault\(\)/);
});

test("required public pages have titles and responsive viewport tags", () => {
  const htmlFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html"));
  assert.ok(htmlFiles.length >= 10);
  for (const file of htmlFiles) {
    const source = read(file);
    assert.match(source, /<title\b[^>]*>[^<]+<\/title>/i, `${file} title`);
    assert.match(source, /name=["']viewport["']/i, `${file} viewport`);
  }
});
