function normalizeDateOnly(value) {
    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid NewSky date: ${value}`);
    }

    return date.toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
    const normalized = normalizeDateOnly(dateOnly);
    const date = new Date(`${normalized}T00:00:00.000Z`);

    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
}

/**
 * The bydate API's end value is used as an exclusive boundary.
 * Advancing one day ensures that the whole current UTC date is included.
 */
function getNewSkyEndDateExclusive(now = new Date()) {
    return addUtcDays(normalizeDateOnly(now), 1);
}

function getRecentNewSkyDateWindow(days = 7, now = new Date()) {
    const numericDays = Number(days);
    const safeDays = Math.max(
        1,
        Math.min(30, Number.isFinite(numericDays) && numericDays !== 0 ? Math.trunc(numericDays) : 7)
    );
    const today = normalizeDateOnly(now);

    return {
        startDate: addUtcDays(today, -(safeDays - 1)),
        endDateExclusive: getNewSkyEndDateExclusive(now)
    };
}

/**
 * Build contiguous [startDate, endDateExclusive) windows. Using the same
 * boundary as the next window avoids skipped days between API requests.
 */
function buildNewSkyDateRanges(startDate, endDateExclusive, maxDays = 30) {
    let cursor = normalizeDateOnly(startDate);
    const end = normalizeDateOnly(endDateExclusive);

    if (!Number.isInteger(maxDays) || maxDays < 1) {
        throw new Error("NewSky date-range size must be a positive integer.");
    }

    if (cursor > end) {
        throw new Error("NewSky history start date must not be after its end boundary.");
    }

    const ranges = [];

    while (cursor < end) {
        const nextBoundary = addUtcDays(cursor, maxDays);
        const boundary = nextBoundary < end ? nextBoundary : end;

        ranges.push({
            startDate: cursor,
            endDateExclusive: boundary
        });

        cursor = boundary;
    }

    return ranges;
}

module.exports = {
    buildNewSkyDateRanges,
    getNewSkyEndDateExclusive,
    getRecentNewSkyDateWindow
};
