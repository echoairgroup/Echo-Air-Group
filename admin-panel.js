/* Echo Air Group admin dashboard */
(() => {
    "use strict";

    const API_BASE = "https://echo-air-group-api.onrender.com/api";
    const TOKEN_KEY = "eag_admin_token";
    const $ = (selector) => document.querySelector(selector);

    let token = sessionStorage.getItem(TOKEN_KEY) || "";
    let items = [];
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
            const session = await request("/admin/site/session");
            $("#adminUsername").textContent = session.username || "Admin";
            $("#adminLogin").hidden = true;
            $("#adminDashboard").hidden = false;
            clearStatus("#loginStatus");
            await Promise.all([loadItems(), loadSettings()]);
            showView("overview");
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
            [item.category, item.target_page === "all" ? "All pages" : item.target_page, item.published ? "Published" : "Draft"].forEach((value, index) => {
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

    function resetItemForm() {
        editingId = null;
        $("#itemForm").reset();
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

            status("#itemStatus", result.message || "Saved.");
            resetItemForm();
            status("#itemStatus", result.message || "Saved.");
            await loadItems();
            showView("manage");
        } catch (error) {
            status("#itemStatus", error.message, "error");
        } finally {
            button.disabled = false;
        }
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

    authenticateAndLoad();
})();
