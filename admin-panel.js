/* Echo Air Group admin dashboard */
(() => {
    "use strict";

    const API_BASE = "https://echo-air-group-api.onrender.com/api";
    const TOKEN_KEY = "eag_admin_token";
    const $ = (selector) => document.querySelector(selector);

    let token = sessionStorage.getItem(TOKEN_KEY) || "";
    let items = [];
    let applications = [];
    let editingId = null;

    function status(target, message, type = "success") {
        const node = typeof target === "string" ? $(target) : target;
        if (!node) return;
        node.textContent = message;
        node.classList.add("show");
        node.classList.toggle("error", type === "error");
    }

    function clearStatus(target) {
        const node = typeof target === "string" ? $(target) : target;
        if (!node) return;
        node.textContent = "";
        node.classList.remove("show", "error");
    }

    async function request(path, options = {}, includeToken = true) {
        const headers = { ...(options.headers || {}) };
        if (options.body !== undefined && !(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        if (includeToken && token) headers.Authorization = "Bearer " + token;

        const response = await fetch(API_BASE + path, { ...options, headers });
        const raw = await response.text();
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; }
        catch { payload = { error: raw || "Unexpected server response." }; }

        if (!response.ok) {
            const error = new Error(payload.error || "Request failed (" + response.status + ").");
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function showLogin(message = "") {
        $("#adminLogin").hidden = false;
        $("#adminDashboard").hidden = true;
        if (message) status("#loginStatus", message, "error");
    }

    async function authenticateAndLoad() {
        if (!token) {
            showLogin();
            return;
        }

        try {
            const session = await request("/platform/admin/session");
            window.EAGPlatformAdminSession = session;
            $("#adminUsername").textContent = (session.username || "Admin") + " · " + String(session.role || "admin").replace(/_/g, " ");
            $("#adminLogin").hidden = true;
            $("#adminDashboard").hidden = false;
            clearStatus("#loginStatus");

            const can = (permission) => Array.isArray(session.permissions) && (session.permissions.includes("*") || session.permissions.includes(permission));
            const legacyTabPermissions = {
                add: "content.write",
                manage: "content.write",
                applications: "applications.read",
                settings: "content.write",
                import: "content.write"
            };
            Object.entries(legacyTabPermissions).forEach(([name, permission]) => {
                const tab = document.querySelector('[data-admin-tab="' + name + '"]');
                if (tab) tab.hidden = !can(permission);
            });
            const legacyLoads = [];
            if (can("content.read")) legacyLoads.push(loadItems(), loadSettings());
            if (can("applications.read")) legacyLoads.push(loadApplications());
            await Promise.all(legacyLoads);

            const platformTabs = {
                operations: "operations.read",
                routes: "routes.write",
                fleet: "fleet.read",
                system: "system.read",
                roles: "roles.read",
                audit: "audit.read",
                notifications: "notifications.read",
                privacy: "privacy.read",
                academy: "academy.read"
            };
            Object.entries(platformTabs).forEach(([name, permission]) => {
                const tab = document.querySelector('[data-admin-tab="' + name + '"]');
                if (tab) tab.hidden = !can(permission);
            });
            showView(session.isRootAdmin ? "overview" : (can("operations.read") ? "operations" : "academy"));
        } catch (error) {
            if (error.status === 401) {
                token = "";
                sessionStorage.removeItem(TOKEN_KEY);
                showLogin("Your session expired. Please sign in again.");
                return;
            }
            showLogin(error.message);
        }
    }

    function showView(name) {
        document.querySelectorAll("[data-admin-view]").forEach((view) => {
            view.hidden = view.dataset.adminView !== name;
        });
        document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.adminTab === name);
        });
        if (name === "add" && editingId === null) $("#itemFormTitle").textContent = "Add a website item";
        if (name === "applications" && token) loadApplications().catch((error) => status("#applicationsStatus", error.message, "error"));
        if (name === "privacy" && token) loadCookieConsent().catch((error) => status("#cookieConsentStatus", error.message, "error"));
    }

    async function loadItems() {
        const payload = await request("/admin/site/items");
        items = Array.isArray(payload.items) ? payload.items : [];
        $("#statTotal").textContent = String(payload.stats?.total ?? items.length);
        $("#statPublished").textContent = String(payload.stats?.published ?? items.filter((item) => item.published).length);
        $("#statDrafts").textContent = String(payload.stats?.drafts ?? items.filter((item) => !item.published).length);
        renderItems();
    }

    function fullImageUrl(url) {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        return API_BASE.replace(/\/api$/, "") + url;
    }

    function renderItems() {
        const list = $("#adminItemList");
        list.replaceChildren();

        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "admin-empty";
            empty.textContent = "No website items yet. Use “Add item” to publish your first update.";
            list.appendChild(empty);
            return;
        }

        items.forEach((item) => {
            const row = document.createElement("article");
            row.className = "admin-item";

            if (item.image_url) {
                const image = document.createElement("img");
                image.className = "admin-item-image";
                image.src = fullImageUrl(item.image_url);
                image.alt = "";
                image.loading = "lazy";
                row.appendChild(image);
            } else {
                const imagePlaceholder = document.createElement("div");
                imagePlaceholder.className = "admin-item-image";
                imagePlaceholder.setAttribute("aria-hidden", "true");
                row.appendChild(imagePlaceholder);
            }

            const info = document.createElement("div");
            const title = document.createElement("h3");
            title.className = "admin-item-title";
            title.textContent = item.title;
            info.appendChild(title);

            const meta = document.createElement("div");
            meta.className = "admin-item-meta";
            [
                item.category,
                String(item.category || "").toLowerCase() === "news"
                    ? "Homepage News section"
                    : (item.target_page === "all" ? "All pages" : item.target_page),
                item.published ? "Published" : "Draft"
            ].forEach((value, index) => {
                const chip = document.createElement("span");
                chip.className = "admin-chip" + (index === 2 && !item.published ? " draft" : "");
                chip.textContent = String(value || "").replace(/[-_]/g, " ");
                meta.appendChild(chip);
            });
            info.appendChild(meta);

            if (item.description) {
                const description = document.createElement("p");
                description.className = "admin-item-description";
                description.textContent = item.description;
                info.appendChild(description);
            }

            row.appendChild(info);

            const actions = document.createElement("div");
            actions.className = "admin-item-actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "admin-button secondary";
            edit.dataset.editItem = String(item.id);
            edit.textContent = "Edit";
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "admin-button danger";
            remove.dataset.deleteItem = String(item.id);
            remove.textContent = "Delete";
            actions.append(edit, remove);
            row.appendChild(actions);

            list.appendChild(row);
        });
    }

    async function loadSettings() {
        const settings = await request("/admin/site/settings");
        $("#discordInvite").value = settings.discordInvite || "";
    }

    async function loadCookieConsent() {
        const payload = await request("/admin/cookie-consent");
        const stats = payload.stats || {};
        $("#cookieConsentTotal").textContent = String(stats.total ?? 0);
        $("#cookieConsentAccepted").textContent = String(stats.accepted ?? 0);
        $("#cookieConsentRejected").textContent = String(stats.rejected ?? 0);
        $("#cookieConsentCustom").textContent = String(stats.custom ?? 0);

        const container = $("#cookieConsentList");
        container.replaceChildren();
        const records = Array.isArray(payload.records) ? payload.records : [];
        if (!records.length) {
            container.appendChild(createAppNode("div", "admin-empty", "No cookie preferences have been recorded yet."));
            return;
        }

        const wrap = createAppNode("div", "platform-admin-table-wrap");
        const table = createAppNode("table", "platform-admin-table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["Visitor / account", "Choice", "Analytics", "Marketing", "Last updated"].forEach(label => {
            headerRow.appendChild(createAppNode("th", "", label));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        records.forEach(record => {
            const row = document.createElement("tr");
            const visitorLabel = record.username
                ? String(record.username)
                : "Anonymous visitor · " + String(record.visitor_id || "").slice(0, 8);
            const choiceLabel = {
                accepted: "Accepted all",
                rejected: "Rejected optional",
                custom: "Custom preferences"
            }[record.choice] || "Unknown";
            const date = record.updated_at
                ? new Date(record.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
                : "Not available";
            [
                visitorLabel,
                choiceLabel,
                record.analytics_enabled ? "Allowed" : "Off",
                record.marketing_enabled ? "Allowed" : "Off",
                date
            ].forEach(value => row.appendChild(createAppNode("td", "", value)));
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);

        const totalRecords = Number(payload.totalRecords ?? records.length);
        if (totalRecords > records.length) {
            container.appendChild(createAppNode("p", "admin-help", "Showing the latest " + records.length + " of " + totalRecords + " current browser preferences."));
        }
        clearStatus("#cookieConsentStatus");
    }

    const APPLICATION_STATUSES = [
        ["new", "New"],
        ["reviewing", "In review"],
        ["shortlisted", "Shortlisted"],
        ["accepted", "Accepted"],
        ["rejected", "Rejected"]
    ];

    async function loadApplications() {
        const payload = await request("/admin/applications");
        applications = Array.isArray(payload.applications) ? payload.applications : [];
        const stats = payload.stats || {};
        $("#applicationTotal").textContent = String(stats.total ?? applications.length);
        $("#applicationNew").textContent = String(stats.new ?? applications.filter((app) => app.status === "new").length);
        $("#applicationInProgress").textContent = String(stats.in_progress ?? applications.filter((app) => ["reviewing", "shortlisted"].includes(app.status)).length);
        $("#applicationAccepted").textContent = String(stats.accepted ?? applications.filter((app) => app.status === "accepted").length);
        $("#applicationTabCount").textContent = String(stats.new ?? applications.filter((app) => app.status === "new").length);
        renderApplications();
        clearStatus("#applicationsStatus");
    }

    function applicationDate(value) {
        if (!value) return "Date unavailable";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? "Date unavailable"
            : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    function createAppNode(tag, className, value) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = String(value);
        return node;
    }

    function renderApplications() {
        const list = $("#adminApplicationList");
        if (!list) return;
        list.replaceChildren();

        const search = ($("#applicationSearch")?.value || "").trim().toLowerCase();
        const typeFilter = $("#applicationTypeFilter")?.value || "all";
        const statusFilter = $("#applicationStatusFilter")?.value || "all";

        const filtered = applications.filter((app) => {
            if (typeFilter !== "all" && app.application_type !== typeFilter) return false;
            if (statusFilter !== "all" && app.status !== statusFilter) return false;
            if (!search) return true;
            const answerText = Object.entries(app.answers || {}).map(([key, value]) => key + " " + value).join(" ");
            return [app.full_name, app.email, app.discord_username, app.application_type, app.status, answerText]
                .some((value) => String(value || "").toLowerCase().includes(search));
        });

        if (!filtered.length) {
            const empty = createAppNode("div", "admin-empty",
                applications.length
                    ? "No applications match these filters. Try a broader search."
                    : "No applications have been captured yet. New pilot and manager submissions will appear here.");
            list.appendChild(empty);
            return;
        }

        filtered.forEach((app) => {
            const card = createAppNode("article", "admin-application-card");
            const heading = createAppNode("div", "admin-application-heading");
            const identity = document.createElement("div");
            identity.appendChild(createAppNode("h3", "", app.full_name || "Applicant"));
            const meta = createAppNode("div", "admin-application-meta");
            meta.appendChild(createAppNode("span", "", app.application_type === "manager" ? "Manager application" : "Pilot application"));
            meta.appendChild(createAppNode("span", "", applicationDate(app.submitted_at)));

            const email = document.createElement("a");
            email.href = "mailto:" + String(app.email || "");
            email.textContent = app.email || "No email";
            meta.appendChild(email);
            if (app.discord_username) meta.appendChild(createAppNode("span", "", "Discord: " + app.discord_username));
            identity.appendChild(meta);

            const badge = createAppNode("span", "admin-application-badge " + String(app.status || "new"), (app.status || "new").replace(/[-_]/g, " "));
            heading.append(identity, badge);

            const body = createAppNode("div", "admin-application-body");
            const answersDisclosure = document.createElement("details");
            answersDisclosure.className = "admin-application-answers";
            const answerSummary = createAppNode("summary", "", "View full application (" + Object.keys(app.answers || {}).length + " answers)");
            const answersGrid = createAppNode("div", "admin-application-answer-grid");
            const answers = app.answers && typeof app.answers === "object" ? app.answers : {};
            Object.entries(answers).forEach(([question, answer]) => {
                const field = createAppNode("div", "admin-application-answer");
                field.appendChild(createAppNode("strong", "", question));
                field.appendChild(createAppNode("p", "", answer || "—"));
                answersGrid.appendChild(field);
            });
            answersDisclosure.append(answerSummary, answersGrid);

            const toolbar = createAppNode("div", "admin-application-toolbar");
            const statusField = createAppNode("div", "admin-application-field");
            const statusLabel = createAppNode("label", "", "Application status");
            statusLabel.htmlFor = "application-status-" + app.id;
            const statusSelect = document.createElement("select");
            statusSelect.id = statusLabel.htmlFor;
            statusSelect.dataset.applicationStatus = String(app.id);
            APPLICATION_STATUSES.forEach(([value, label]) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                statusSelect.appendChild(option);
            });
            statusSelect.value = APPLICATION_STATUSES.some(([value]) => value === app.status) ? app.status : "new";
            statusField.append(statusLabel, statusSelect);

            const notesField = createAppNode("div", "admin-application-field");
            const notesLabel = createAppNode("label", "", "Private admin notes");
            notesLabel.htmlFor = "application-notes-" + app.id;
            const notes = document.createElement("textarea");
            notes.id = notesLabel.htmlFor;
            notes.maxLength = 5000;
            notes.placeholder = "Interview notes, follow-up, decision context…";
            notes.value = app.admin_notes || "";
            notes.dataset.applicationNotes = String(app.id);
            notesField.append(notesLabel, notes);
            toolbar.append(statusField, notesField);

            const actions = createAppNode("div", "admin-application-actions");
            const save = createAppNode("button", "admin-button primary", "Save review");
            save.type = "button";
            save.dataset.saveApplication = String(app.id);
            const remove = createAppNode("button", "admin-button danger", "Delete record");
            remove.type = "button";
            remove.dataset.deleteApplication = String(app.id);
            actions.append(save, remove);

            body.append(answersDisclosure, toolbar, actions);
            card.append(heading, body);
            list.appendChild(card);
        });
    }

    async function saveApplicationReview(id, card) {
        const statusSelect = card.querySelector("[data-application-status]");
        const notes = card.querySelector("[data-application-notes]");
        const saveButton = card.querySelector("[data-save-application]");
        if (!statusSelect || !notes || !saveButton) return;

        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
        try {
            await request("/admin/applications/" + encodeURIComponent(id), {
                method: "PATCH",
                body: JSON.stringify({
                    status: statusSelect.value,
                    adminNotes: notes.value
                })
            });
            status("#applicationsStatus", "Application review saved.");
            await loadApplications();
        } catch (error) {
            status("#applicationsStatus", error.message, "error");
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = "Save review";
        }
    }

    function exportApplicationsCsv() {
        if (!applications.length) {
            status("#applicationsStatus", "There are no application records to export.", "error");
            return;
        }

        const answerKeys = Array.from(new Set(applications.flatMap((app) =>
            Object.keys(app.answers && typeof app.answers === "object" ? app.answers : {})
        )));
        const headers = ["ID", "Type", "Name", "Email", "Discord", "Status", "Submitted", "Admin Notes", ...answerKeys];
        const cell = (value) => {
            let text = String(value ?? "").replace(/\r\n/g, "\n");
            // Prevent spreadsheet formula execution in exported applicant-supplied fields.
            if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        };
        const lines = [headers.map(cell).join(",")];
        applications.forEach((app) => {
            const answers = app.answers && typeof app.answers === "object" ? app.answers : {};
            const row = [
                app.id, app.application_type, app.full_name, app.email, app.discord_username,
                app.status, app.submitted_at, app.admin_notes,
                ...answerKeys.map((key) => answers[key] ?? "")
            ];
            lines.push(row.map(cell).join(","));
        });
        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "echo-air-group-applications-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        status("#applicationsStatus", "CSV export created.");
    }

    function syncNewsTargetPage() {
        const isNews = $("#itemCategory").value === "news";
        const pageSelect = $("#itemTargetPage");
        const help = $("#targetPageHelp");

        if (isNews) {
            pageSelect.value = "index.html";
            pageSelect.disabled = true;
            if (help) help.textContent = "News items are automatically placed in the homepage News section.";
        } else {
            pageSelect.disabled = false;
            if (help) help.textContent = "Choose where this item should appear.";
        }
    }

    function resetItemForm() {
        editingId = null;
        $("#itemForm").reset();
        syncNewsTargetPage();
        $("#itemPublished").checked = true;
        $("#itemFormTitle").textContent = "Add a website item";
        $("#itemSaveButton").textContent = "Publish item";
        $("#itemImageUrl").value = "";
        $("#itemImageFile").value = "";
        $("#removeItemImage").checked = false;
        $("#itemImagePreview").src = "";
        $("#itemImagePreview").classList.remove("show");
        clearStatus("#itemStatus");
    }

    function editItem(item) {
        editingId = item.id;
        $("#itemFormTitle").textContent = "Edit website item";
        $("#itemSaveButton").textContent = "Save changes";
        $("#itemTitle").value = item.title || "";
        $("#itemDescription").value = item.description || "";
        $("#itemCategory").value = item.category || "announcement";
        $("#itemTargetPage").value = item.target_page || "all";
        syncNewsTargetPage();
        $("#itemLinkUrl").value = item.link_url || "";
        $("#itemPublished").checked = Boolean(item.published);
        $("#itemImageFile").value = "";
        $("#removeItemImage").checked = false;
        $("#itemImageUrl").value = item.image_url && /^https?:\/\//i.test(item.image_url) ? item.image_url : "";
        const preview = $("#itemImagePreview");
        if (item.image_url) {
            preview.src = fullImageUrl(item.image_url);
            preview.classList.add("show");
        } else {
            preview.src = "";
            preview.classList.remove("show");
        }
        clearStatus("#itemStatus");
        showView("add");
        $("#itemForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read the image file."));
            reader.readAsDataURL(file);
        });
    }

    $("#loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus("#loginStatus");
        const button = $("#loginButton");
        button.disabled = true;

        try {
            const payload = await request("/auth/login", {
                method: "POST",
                body: JSON.stringify({
                    username: $("#loginUsername").value.trim(),
                    password: $("#loginPassword").value
                })
            }, false);

            token = payload.token || "";
            if (!token) throw new Error("The login response did not contain a session token.");
            sessionStorage.setItem(TOKEN_KEY, token);
            $("#loginPassword").value = "";
            await authenticateAndLoad();
        } catch (error) {
            status("#loginStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
        tab.addEventListener("click", () => showView(tab.dataset.adminTab));
    });

    $("#logoutButton").addEventListener("click", () => {
        token = "";
        sessionStorage.removeItem(TOKEN_KEY);
        resetItemForm();
        showLogin("You have signed out of the admin dashboard.");
    });

    $("#itemImageFile").addEventListener("change", async () => {
        clearStatus("#itemStatus");
        const file = $("#itemImageFile").files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            $("#itemImageFile").value = "";
            status("#itemStatus", "Choose a JPG, PNG or WebP image.", "error");
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            $("#itemImageFile").value = "";
            status("#itemStatus", "Images must be 2 MB or smaller.", "error");
            return;
        }
        $("#itemImageUrl").value = "";
        $("#removeItemImage").checked = false;
        const preview = $("#itemImagePreview");
        preview.src = await readFileAsDataUrl(file);
        preview.classList.add("show");
    });

    $("#itemImageUrl").addEventListener("input", () => {
        if ($("#itemImageUrl").value.trim()) {
            $("#itemImageFile").value = "";
            $("#removeItemImage").checked = false;
            $("#itemImagePreview").src = $("#itemImageUrl").value.trim();
            $("#itemImagePreview").classList.add("show");
        }
    });

    $("#removeItemImage").addEventListener("change", () => {
        if ($("#removeItemImage").checked) {
            $("#itemImageFile").value = "";
            $("#itemImageUrl").value = "";
            $("#itemImagePreview").src = "";
            $("#itemImagePreview").classList.remove("show");
        }
    });

    $("#itemForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus("#itemStatus");
        const button = $("#itemSaveButton");
        button.disabled = true;

        try {
            const file = $("#itemImageFile").files?.[0];
            const body = {
                title: $("#itemTitle").value.trim(),
                description: $("#itemDescription").value.trim(),
                category: $("#itemCategory").value,
                targetPage: $("#itemTargetPage").value,
                linkUrl: $("#itemLinkUrl").value.trim(),
                imageUrl: $("#itemImageUrl").value.trim(),
                published: $("#itemPublished").checked,
                removeImage: $("#removeItemImage").checked
            };

            if (file) body.imageDataUrl = await readFileAsDataUrl(file);
            if (file) body.imageUrl = "";

            const path = editingId === null
                ? "/admin/site/items"
                : "/admin/site/items/" + encodeURIComponent(editingId);
            const result = await request(path, {
                method: editingId === null ? "POST" : "PUT",
                body: JSON.stringify(body)
            });

            const savedMessage = result.message || "Saved.";
            resetItemForm();
            await loadItems();
            clearStatus("#manageStatus");
            status("#manageStatus", savedMessage);
            showView("manage");
        } catch (error) {
            status("#itemStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    $("#itemCancelButton").addEventListener("click", () => {
        resetItemForm();
        showView("manage");
    });

    $("#newItemButton").addEventListener("click", () => {
        resetItemForm();
        showView("add");
    });

    $("#adminItemList").addEventListener("click", async (event) => {
        const editButton = event.target.closest("[data-edit-item]");
        const deleteButton = event.target.closest("[data-delete-item]");

        if (editButton) {
            const item = items.find((entry) => String(entry.id) === editButton.dataset.editItem);
            if (item) editItem(item);
            return;
        }

        if (deleteButton) {
            const item = items.find((entry) => String(entry.id) === deleteButton.dataset.deleteItem);
            if (!item || !window.confirm('Delete "' + item.title + '" from the website?')) return;

            try {
                await request("/admin/site/items/" + encodeURIComponent(item.id), { method: "DELETE" });
                await loadItems();
                status("#manageStatus", "Item deleted.");
            } catch (error) {
                status("#manageStatus", error.message, "error");
            }
        }
    });

    $("#discordSettingsForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus("#settingsStatus");
        const button = $("#saveSettingsButton");
        button.disabled = true;

        try {
            const result = await request("/admin/site/settings", {
                method: "PUT",
                body: JSON.stringify({ discordInvite: $("#discordInvite").value.trim() })
            });
            $("#discordInvite").value = result.discordInvite;
            status("#settingsStatus", "Discord invite saved. All site pages will use the new link when they reload.");
        } catch (error) {
            status("#settingsStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    $("#importForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus("#importStatus");
        const file = $("#importFile").files?.[0];
        if (!file) {
            status("#importStatus", "Choose a JSON file first.", "error");
            return;
        }

        const button = $("#importButton");
        button.disabled = true;
        try {
            const parsed = JSON.parse(await file.text());
            const payload = Array.isArray(parsed) ? { items: parsed } : parsed;
            const result = await request("/admin/site/items/import", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            status("#importStatus", result.message || "Import complete.");
            $("#importFile").value = "";
            await loadItems();
        } catch (error) {
            status("#importStatus", error instanceof SyntaxError ? "That file is not valid JSON." : error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    $("#itemCategory").addEventListener("change", syncNewsTargetPage);
    syncNewsTargetPage();

    $("#applicationSearch").addEventListener("input", renderApplications);
    $("#applicationTypeFilter").addEventListener("change", renderApplications);
    $("#applicationStatusFilter").addEventListener("change", renderApplications);
    $("#refreshApplicationsButton").addEventListener("click", async () => {
        const button = $("#refreshApplicationsButton");
        button.disabled = true;
        try {
            await loadApplications();
            status("#applicationsStatus", "Application list refreshed.");
        } catch (error) {
            status("#applicationsStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
    });
    $("#exportApplicationsButton").addEventListener("click", exportApplicationsCsv);
    $("#refreshCookieConsentButton").addEventListener("click", async () => {
        const button = $("#refreshCookieConsentButton");
        button.disabled = true;
        try {
            await loadCookieConsent();
            status("#cookieConsentStatus", "Cookie preference records refreshed.");
        } catch (error) {
            status("#cookieConsentStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    $("#adminApplicationList").addEventListener("click", async (event) => {
        const saveButton = event.target.closest("[data-save-application]");
        const deleteButton = event.target.closest("[data-delete-application]");

        if (saveButton) {
            const card = saveButton.closest(".admin-application-card");
            await saveApplicationReview(saveButton.dataset.saveApplication, card);
            return;
        }

        if (deleteButton) {
            const application = applications.find((item) => String(item.id) === deleteButton.dataset.deleteApplication);
            if (!application || !window.confirm("Permanently delete the application from " + application.full_name + "?")) return;

            try {
                await request("/admin/applications/" + encodeURIComponent(application.id), { method: "DELETE" });
                await loadApplications();
                status("#applicationsStatus", "Application record deleted.");
            } catch (error) {
                status("#applicationsStatus", error.message, "error");
            }
        }
    });

    authenticateAndLoad();
})();
