(() => {
    "use strict";

    const API = "https://echo-air-group-api.onrender.com/api";
    const $ = (selector) => document.querySelector(selector);
    const pilotToken = () => localStorage.getItem("echo_token") || "";
    const adminToken = () => sessionStorage.getItem("eag_admin_token") || "";
    let editingEventId = null;

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = String(text);
        return element;
    }

    function formatDate(value) {
        if (!value) return "Date to be confirmed";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Date to be confirmed" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    async function request(path, options, tokenType) {
        const opts = options || {};
        const headers = { Accept: "application/json", ...(opts.headers || {}) };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        const token = tokenType === "admin" ? adminToken() : tokenType === "pilot" ? pilotToken() : (adminToken() || pilotToken());
        if (token) headers.Authorization = "Bearer " + token;
        const response = await fetch(API + path, { ...opts, headers, cache: "no-store" });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
        if (!response.ok) {
            const error = new Error(data.error || "Request failed (" + response.status + ").");
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function statusMessage(target, message, isError) {
        if (!target) return;
        target.textContent = message || "";
        target.classList.toggle("error", isError === true);
    }

    function safeUrl(raw) {
        const value = String(raw || "").trim();
        if (!value) return null;
        try {
            const url = new URL(value, window.location.href);
            if (url.protocol !== "https:" && url.protocol !== "http:") return null;
            return url.href;
        } catch (_error) {
            return null;
        }
    }

    async function loadCommunity() {
        const [eventData, newsData, spotlightData] = await Promise.all([
            request("/community/events"),
            request("/community/announcements"),
            request("/community/spotlight")
        ]);
        renderEvents(eventData.events || []);
        renderAnnouncements(newsData.announcements || []);
        renderSpotlight(spotlightData.pilots || []);
        const events = eventData.events || [];
        $("#communityEventCount").textContent = String(events.filter(event => new Date(event.startsAt).getTime() >= Date.now()).length);
        $("#communityNewsCount").textContent = String((newsData.announcements || []).length);
        $("#communityGroupCount").textContent = String(events.filter(event => event.type === "group-flight" || event.type === "training").length);
    }

    function renderEvents(events) {
        const root = $("#communityEvents");
        root.replaceChildren();
        const upcoming = events.filter(event => new Date(event.startsAt).getTime() >= Date.now() - 3600000);
        if (!upcoming.length) {
            root.appendChild(node("div", "community-empty", "No upcoming community events are published yet. Check back soon or follow our Discord announcements."));
            return;
        }

        upcoming.forEach((event) => {
            const card = node("article", "community-event-card");
            const top = node("div", "community-event-top");
            const meta = node("div", "community-event-meta");
            const typeLabel = event.type.replace(/-/g, " ");
            meta.append(node("span", "community-event-type", typeLabel), node("span", "community-event-date", formatDate(event.startsAt)));
            const title = node("h3", "", event.title);
            const location = node("div", "community-event-location", event.location || "Location to be confirmed");
            top.append(meta, title, location);

            const body = node("div", "community-event-body");
            body.appendChild(node("p", "community-event-description", event.description || "More information will be shared by the event organiser."));
            const footer = node("div", "community-event-footer");
            const attending = Number(event.attendingCount || 0);
            const interested = Number(event.interestedCount || 0);
            const countText = event.capacity
                ? attending + " / " + event.capacity + " attending · " + interested + " interested"
                : attending + " attending · " + interested + " interested";
            footer.appendChild(node("div", "community-event-counts", countText));
            const actions = node("div", "community-rsvp-actions");

            if (!pilotToken()) {
                const signIn = node("a", "attend", "Pilot sign in");
                signIn.href = "ranking.html";
                actions.appendChild(signIn);
            } else if (event.myRsvp) {
                const state = node("span", "community-event-type", event.myRsvp === "attending" ? "You are attending" : "You are interested");
                actions.prepend(state);
                const cancel = node("button", "", "Cancel");
                cancel.type = "button";
                cancel.addEventListener("click", async () => {
                    cancel.disabled = true;
                    try {
                        await request("/community/events/" + encodeURIComponent(event.id) + "/rsvp", { method: "DELETE" }, "pilot");
                        await loadCommunity();
                        await loadMyEvents();
                    } catch (error) {
                        window.alert(error.message);
                        cancel.disabled = false;
                    }
                });
                actions.appendChild(cancel);
            } else {
                const full = event.capacity !== null && event.capacity !== undefined && attending >= Number(event.capacity);
                const attend = node("button", "attend", full ? "Full" : "Attend");
                attend.type = "button";
                attend.disabled = full || new Date(event.startsAt).getTime() < Date.now();
                attend.addEventListener("click", () => saveRsvp(event.id, "attending", attend));
                const interestedButton = node("button", "", "Interested");
                interestedButton.type = "button";
                interestedButton.addEventListener("click", () => saveRsvp(event.id, "interested", interestedButton));
                actions.append(attend, interestedButton);
            }
            footer.appendChild(actions);
            body.appendChild(footer);
            card.append(top, body);
            root.appendChild(card);
        });
    }

    async function saveRsvp(eventId, status, button) {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Saving…";
        try {
            await request("/community/events/" + encodeURIComponent(eventId) + "/rsvp", {
                method: "POST",
                body: JSON.stringify({ status })
            }, "pilot");
            await loadCommunity();
            await loadMyEvents();
        } catch (error) {
            button.disabled = false;
            button.textContent = original;
            window.alert(error.message);
        }
    }

    function renderSpotlight(pilots) {
        const root = $("#communitySpotlight");
        root.replaceChildren();
        if (!pilots.length) {
            root.appendChild(node("div", "community-empty", "No completed flights were recorded during the last 30 days."));
            return;
        }
        pilots.forEach((pilot) => {
            const row = node("div", "community-spotlight-row");
            const rank = node("span", "community-spotlight-rank", "#" + pilot.rank);
            const identity = node("div", "community-spotlight-identity");
            identity.append(
                node("strong", "", pilot.pilotName),
                node("small", "", Number(pilot.flights || 0) + " completed flights · " + Math.round(Number(pilot.distanceNm || 0)).toLocaleString("en-GB") + " nm")
            );
            row.append(rank, identity);
            root.appendChild(row);
        });
    }

    function renderAnnouncements(items) {
        const root = $("#communityAnnouncements");
        root.replaceChildren();
        if (!items.length) {
            root.appendChild(node("div", "community-empty", "No announcements have been published yet."));
            return;
        }
        items.slice(0, 10).forEach((item) => {
            const article = node("article", "community-announcement");
            article.append(
                node("small", "", formatDate(item.createdAt)),
                node("h3", "", item.title),
                node("p", "", item.body || "")
            );
            const url = safeUrl(item.url);
            if (url) {
                const link = node("a", "", "Read update →");
                link.href = url;
                link.rel = "noopener noreferrer";
                link.target = "_blank";
                article.appendChild(link);
            }
            root.appendChild(article);
        });
    }

    async function loadMyEvents() {
        const root = $("#myCommunityEvents");
        if (!pilotToken()) {
            root.replaceChildren(node("div", "community-empty", "Sign in to your Echo Air Group pilot account to see and manage your event registrations. The Pilot Dashboard contains your account sign-in."));
            return;
        }
        try {
            const data = await request("/community/my-events", {}, "pilot");
            root.replaceChildren();
            if (!(data.events || []).length) {
                root.appendChild(node("div", "community-empty", "You have not registered for any upcoming events yet."));
                return;
            }
            data.events.forEach((event) => {
                const row = node("div", "community-my-event");
                const details = node("div");
                details.append(
                    node("strong", "", event.title),
                    node("small", "", formatDate(event.starts_at) + " · " + (event.location || "Location TBC") + " · " + event.my_rsvp)
                );
                const cancel = node("button", "", "Cancel RSVP");
                cancel.type = "button";
                cancel.addEventListener("click", async () => {
                    cancel.disabled = true;
                    try {
                        await request("/community/events/" + encodeURIComponent(event.id) + "/rsvp", { method: "DELETE" }, "pilot");
                        await loadCommunity();
                        await loadMyEvents();
                    } catch (error) {
                        window.alert(error.message);
                        cancel.disabled = false;
                    }
                });
                row.append(details, cancel);
                root.appendChild(row);
            });
        } catch (error) {
            root.replaceChildren(node("div", "community-empty", error.message));
        }
    }

    async function loadStaffWorkspace() {
        if (!adminToken()) return;
        try {
            const session = await request("/platform/admin/session", {}, "admin");
            const permissions = session.permissions || [];
            const canManage = session.role === "super_admin" || session.role === "admin" ||
                session.role === "operations_manager" || permissions.includes("*") || permissions.includes("events.manage");
            if (!canManage) return;
            $("#communityStaffPanel").hidden = false;
            $("#communityRoleLabel").textContent = (session.role || "Community staff").replace(/_/g, " ");
            await loadStaffEvents();
        } catch (_error) {
            // Public visitors and pilots without event-management rights only see the public community.
        }
    }

    async function loadStaffEvents() {
        const root = $("#staffEventList");
        try {
            const data = await request("/platform/admin/community/events", {}, "admin");
            root.replaceChildren();
            if (!(data.events || []).length) {
                root.appendChild(node("div", "community-empty", "No community events have been created."));
                return;
            }
            data.events.forEach((event) => {
                const row = node("div", "community-staff-event");
                const details = node("div");
                details.append(
                    node("strong", "", event.title),
                    node("small", "", formatDate(event.starts_at) + " · " + Number(event.attending_count || 0) + " attending · " + (event.published ? "Published" : "Draft"))
                );
                const actions = node("div", "community-staff-event-actions");
                const edit = node("button", "", "Edit");
                edit.type = "button";
                edit.addEventListener("click", () => fillEventForm(event));
                const remove = node("button", "danger", "Delete");
                remove.type = "button";
                remove.addEventListener("click", async () => {
                    if (!window.confirm("Delete this event and its registrations? This cannot be undone.")) return;
                    try {
                        await request("/platform/admin/community/events/" + event.id, { method: "DELETE" }, "admin");
                        await loadStaffEvents();
                        await loadCommunity();
                    } catch (error) {
                        window.alert(error.message);
                    }
                });
                actions.append(edit, remove);
                row.append(details, actions);
                root.appendChild(row);
            });
        } catch (error) {
            root.replaceChildren(node("div", "community-empty", error.message));
        }
    }

    function localDateTime(value) {
        if (!value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    function fillEventForm(event) {
        editingEventId = Number(event.id);
        const form = $("#eventForm");
        form.elements.title.value = event.title || "";
        form.elements.description.value = event.description || "";
        form.elements.eventType.value = event.event_type || "community";
        form.elements.location.value = event.location || "";
        form.elements.startsAt.value = localDateTime(event.starts_at);
        form.elements.endsAt.value = localDateTime(event.ends_at);
        form.elements.capacity.value = event.capacity === null ? "" : event.capacity;
        form.elements.published.checked = event.published === true;
        $("#eventFormTitle").textContent = "Edit community event";
        $("#saveEventButton").textContent = "Save changes";
        $("#cancelEventEdit").hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function resetEventForm() {
        editingEventId = null;
        $("#eventForm").reset();
        $("#eventForm").elements.published.checked = true;
        $("#eventFormTitle").textContent = "Create a community event";
        $("#saveEventButton").textContent = "Publish event";
        $("#cancelEventEdit").hidden = true;
        statusMessage($("#eventFormStatus"), "");
    }

    function wireEventForm() {
        const form = $("#eventForm");
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(form);
            const start = new Date(data.get("startsAt"));
            const endValue = data.get("endsAt");
            const end = endValue ? new Date(endValue) : null;
            const capacityValue = data.get("capacity");
            const body = {
                title: data.get("title"),
                description: data.get("description"),
                eventType: data.get("eventType"),
                location: data.get("location"),
                startsAt: Number.isNaN(start.getTime()) ? "" : start.toISOString(),
                endsAt: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
                capacity: capacityValue ? Number(capacityValue) : null,
                published: form.elements.published.checked
            };
            const button = $("#saveEventButton");
            button.disabled = true;
            statusMessage($("#eventFormStatus"), "Saving event…");
            try {
                const path = editingEventId
                    ? "/platform/admin/community/events/" + editingEventId
                    : "/platform/admin/community/events";
                await request(path, { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(body) }, "admin");
                statusMessage($("#eventFormStatus"), editingEventId ? "Event updated." : "Event published.");
                resetEventForm();
                await loadStaffEvents();
                await loadCommunity();
            } catch (error) {
                statusMessage($("#eventFormStatus"), error.message, true);
            } finally {
                button.disabled = false;
            }
        });
        $("#cancelEventEdit").addEventListener("click", resetEventForm);
    }

    async function init() {
        wireEventForm();
        try {
            await loadCommunity();
        } catch (error) {
            $("#communityEvents").replaceChildren(node("div", "community-empty", error.message));
            $("#communityAnnouncements").replaceChildren(node("div", "community-empty", "Announcements could not be loaded."));
        }
        await loadMyEvents();
        await loadStaffWorkspace();
    }

    init();
})();