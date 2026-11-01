const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildNewSkyDateRanges,
    getNewSkyEndDateExclusive,
    getRecentNewSkyDateWindow
} = require("../newsky-date-ranges");

test("the end boundary advances to tomorrow so today is included", () => {
    assert.equal(
        getNewSkyEndDateExclusive(new Date("2026-11-01T16:00:00.000Z")),
        "2026-11-02"
    );
});

test("the recent sync includes the current UTC date", () => {
    assert.deepEqual(
        getRecentNewSkyDateWindow(7, new Date("2026-11-01T16:00:00.000Z")),
        {
            startDate: "2026-10-26",
            endDateExclusive: "2026-11-02"
        }
    );
});

test("the full-history import starts on 1 January 2024 and reaches today", () => {
    const start = "2024-01-01";
    const endExclusive = getNewSkyEndDateExclusive(
        new Date("2026-11-01T16:00:00.000Z")
    );
    const ranges = buildNewSkyDateRanges(start, endExclusive, 30);

    assert.equal(ranges[0].startDate, "2024-01-01");
    assert.equal(ranges.at(-1).endDateExclusive, "2026-11-02");
});

test("history windows are contiguous and have no missing calendar dates", () => {
    const ranges = buildNewSkyDateRanges(
        "2024-01-01",
        "2024-03-15",
        30
    );

    assert.deepEqual(ranges, [
        { startDate: "2024-01-01", endDateExclusive: "2024-01-31" },
        { startDate: "2024-01-31", endDateExclusive: "2024-03-01" },
        { startDate: "2024-03-01", endDateExclusive: "2024-03-15" }
    ]);

    for (let index = 1; index < ranges.length; index += 1) {
        assert.equal(
            ranges[index - 1].endDateExclusive,
            ranges[index].startDate
        );
    }
});

test("the final partial range ends exactly at tomorrow's boundary", () => {
    const ranges = buildNewSkyDateRanges(
        "2026-10-26",
        "2026-11-02",
        30
    );

    assert.deepEqual(ranges, [
        { startDate: "2026-10-26", endDateExclusive: "2026-11-02" }
    ]);
});
