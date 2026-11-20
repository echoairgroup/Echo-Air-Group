const test = require("node:test");
const assert = require("node:assert/strict");

const { getDatabaseConnectionString } = require("../database-connection");

test("uses the Neon pooled hostname for a direct Neon endpoint", () => {
    const direct = "postgresql://user:secret@ep-example-123.c-4.us-east-2.aws.neon.tech/eag?sslmode=require";
    const pooled = getDatabaseConnectionString(direct);

    assert.match(pooled, /ep-example-123-pooler\.c-4\.us-east-2\.aws\.neon\.tech/);
    assert.match(pooled, /sslmode=require/);
    assert.match(pooled, /user:secret@/);
});

test("does not append the pooler suffix twice", () => {
    const pooled = "postgresql://user:secret@ep-example-123-pooler.c-4.us-east-2.aws.neon.tech/eag";
    assert.equal(getDatabaseConnectionString(pooled), pooled);
});

test("leaves non-Neon database URLs unchanged", () => {
    const url = "postgresql://user:secret@db.example.com:5432/eag";
    assert.equal(getDatabaseConnectionString(url), url);
});

test("can disable automatic Neon pooler conversion", () => {
    const direct = "postgresql://user:secret@ep-example-123.c-4.us-east-2.aws.neon.tech/eag";
    assert.equal(getDatabaseConnectionString(direct, false), direct);
});

test("returns an invalid URL unchanged instead of masking the original error", () => {
    const invalid = "not-a-database-url";
    assert.equal(getDatabaseConnectionString(invalid), invalid);
});
