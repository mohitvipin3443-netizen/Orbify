document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('autoSpoofToggle');
    const acceptToggle = document.getElementById('autoAcceptToggle');
    const notifsToggle = document.getElementById('notificationsToggle');
    const hideCompletedToggle = document.getElementById('hideCompletedToggle');
    const questList = document.getElementById('questList');
    const connectionError = document.getElementById('connectionError');
    const connectionErrorText = document.getElementById('connectionErrorText');

    // Version sync from manifest
    const manifest = chrome.runtime.getManifest();
    document.getElementById('versionLabel').textContent = `v${manifest.version}`;

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
        });
    });

    // About tab links
    document.getElementById('link-repo').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'https://github.com/adrielGGmotion/Orbify' });
    });

    // Speed selector
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chrome.storage.local.set({ spoofSpeed: btn.dataset.speed });
        });
    });

    // Store last known quest data for re-rendering when hideCompleted changes
    let lastQuestData = null;

    // Load settings
    chrome.storage.local.get(['autoSpoof', 'autoAccept', 'notifications', 'hideCompleted', 'spoofSpeed', 'stats'], (res) => {
        toggle.checked = !!res.autoSpoof;
        acceptToggle.checked = !!res.autoAccept;
        notifsToggle.checked = res.notifications !== false;
        hideCompletedToggle.checked = !!res.hideCompleted;

        // Speed selector
        const speed = res.spoofSpeed || 'normal';
        document.querySelectorAll('.speed-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.speed === speed);
        });

        // Stats
        loadStats(res.stats);
    });

    toggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ autoSpoof: e.target.checked });
        if (e.target.checked) {
            requestData();
        }
    });

    acceptToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ autoAccept: e.target.checked });
    });

    notifsToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ notifications: e.target.checked });
    });

    hideCompletedToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ hideCompleted: e.target.checked });
        // Re-render with current data
        if (lastQuestData) {
            renderQuests(lastQuestData.available, lastQuestData.currentSpoofQuest);
        }
    });

    function loadStats(stats) {
        stats = stats || { questsSpoofed: 0, timeSaved: 0 };
        document.getElementById('statQuestsSpoofed').textContent = stats.questsSpoofed || 0;
        document.getElementById('statTimeSaved').textContent = formatTimeSaved(stats.timeSaved || 0);
    }

    function formatTimeSaved(seconds) {
        if (seconds <= 0) return "0m";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function requestData() {
        // Route through background.js for proper tab handling
        chrome.runtime.sendMessage({ action: "POPUP_GET_QUESTS" }, (response) => {
            if (chrome.runtime.lastError) {
                questList.innerHTML = `<div class="empty">Please open Discord to use this extension.</div>`;
            }
        });
    }

    // Listen for updates from background/content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "QUESTS_UPDATE") {
            connectionError.classList.add('hidden');
            renderQuests(request.available, request.currentSpoofQuest);
        } else if (request.action === "PROGRESS_UPDATE") {
            updateProgress(request.questId, request.progress, request.secondsDone, request.secondsNeeded);
        } else if (request.action === "SPOOF_STATE_CHANGE") {
            requestData();
        } else if (request.action === "CONNECTION_ERROR") {
            connectionError.classList.remove('hidden');
            connectionErrorText.textContent = request.message || "Couldn't connect to Discord internals. Try reloading the Discord tab.";
        } else if (request.action === "STATS_UPDATED") {
            loadStats(request.stats);
        } else if (request.action === "NO_DISCORD_TABS") {
            questList.innerHTML = `<div class="empty">Please open Discord to use this extension.</div>`;
        }
    });

    function formatTime(seconds) {
        if (seconds <= 0) return "0s";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function renderQuests(available, currentSpoofQuest) {
        lastQuestData = { available, currentSpoofQuest };

        let filtered = available;
        if (hideCompletedToggle.checked) {
            filtered = available.filter(q => q.progress < 100 && !q.completed);
        }

        questList.innerHTML = '';
        if (filtered.length === 0) {
            const msg = available.length > 0 && hideCompletedToggle.checked
                ? "All quests completed! 🎉"
                : "No active quests found.";
            questList.innerHTML = `<div class="empty">${msg}</div>`;
        } else {
            filtered.forEach(q => {
                const el = document.createElement('div');
                el.className = 'quest-card';
                el.id = `quest-${q.id}`;

                const isSpoofingThis = currentSpoofQuest === q.id;
                const isSpoofingOther = currentSpoofQuest && currentSpoofQuest !== q.id;

                let btnHTML = "";
                if (q.progress >= 100 || q.completed) {
                    // No button, user can claim via Discord UI
                } else if (isSpoofingThis) {
                    btnHTML = `<button id="cancel-${q.id}" class="cancel-btn">Cancel</button>`;
                } else {
                    btnHTML = `<button id="btn-${q.id}" ${isSpoofingOther ? 'disabled' : ''}>Start Spoofing</button>`;
                }

                // Build quest card using safe DOM APIs
                const nameDiv = document.createElement('div');
                nameDiv.className = 'quest-name';
                nameDiv.textContent = q.name;

                const taskSpan = document.createElement('span');
                taskSpan.textContent = q.taskName.replace(/_/g, ' ');

                const etaSpan = document.createElement('span');
                etaSpan.id = `eta-${q.id}`;
                etaSpan.className = 'eta-text';
                if (q.progress < 100 && !q.completed) {
                    const remaining = Math.max(0, q.secondsNeeded - q.secondsDone);
                    const clockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2.5px; margin-right: 2px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
                    etaSpan.innerHTML = `${clockSvg}${formatTime(remaining)} left`;
                }

                const pctSpan = document.createElement('span');
                pctSpan.id = `txt-${q.id}`;
                pctSpan.textContent = `${q.progress}%`;

                const progressInfo = document.createElement('div');
                progressInfo.className = 'progress-info';
                progressInfo.appendChild(etaSpan);
                progressInfo.appendChild(pctSpan);

                const statsDiv = document.createElement('div');
                statsDiv.className = 'quest-stats';
                statsDiv.appendChild(taskSpan);
                statsDiv.appendChild(progressInfo);

                const progressBar = document.createElement('div');
                progressBar.className = 'progress-bar';
                progressBar.id = `bar-${q.id}`;
                progressBar.style.width = `${q.progress}%`;

                const progressContainer = document.createElement('div');
                progressContainer.className = 'progress-container';
                progressContainer.appendChild(progressBar);

                el.appendChild(nameDiv);
                el.appendChild(statsDiv);
                el.appendChild(progressContainer);

                // Buttons (hardcoded text, safe to use innerHTML on isolated element)
                if (btnHTML) {
                    const btnContainer = document.createElement('div');
                    btnContainer.innerHTML = btnHTML;
                    while (btnContainer.firstChild) {
                        el.appendChild(btnContainer.firstChild);
                    }
                }

                questList.appendChild(el);

                if (!isSpoofingThis && q.progress < 100 && !q.completed) {
                    const btn = document.getElementById(`btn-${q.id}`);
                    if (btn) {
                        btn.addEventListener('click', () => {
                            btn.disabled = true;
                            btn.textContent = "Requesting...";
                            chrome.runtime.sendMessage({
                                action: "POPUP_START_SPOOF",
                                questId: q.id
                            });
                        });
                    }
                } else if (isSpoofingThis) {
                    const cancelBtn = document.getElementById(`cancel-${q.id}`);
                    if (cancelBtn) {
                        cancelBtn.addEventListener('click', () => {
                            cancelBtn.disabled = true;
                            cancelBtn.textContent = "Canceling...";
                            chrome.runtime.sendMessage({
                                action: "POPUP_CANCEL_SPOOF"
                            });
                        });
                    }
                }
            });
        }
    }

    function updateProgress(questId, progress, secondsDone, secondsNeeded) {
        const bar = document.getElementById(`bar-${questId}`);
        const txt = document.getElementById(`txt-${questId}`);
        const eta = document.getElementById(`eta-${questId}`);
        if (bar) bar.style.width = `${progress}%`;

        if (txt) {
            txt.textContent = `${progress}%`;
        }

        if (eta) {
            let timeText = "";
            if (progress < 100 && secondsNeeded && secondsDone !== undefined) {
                const remaining = Math.max(0, secondsNeeded - secondsDone);
                const clockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2.5px; margin-right: 2px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
                timeText = `${clockSvg}${formatTime(remaining)} left`;
            }
            eta.innerHTML = timeText;
        }

        if (progress >= 100) {
            const btn = document.querySelector(`#quest-${questId} button`);
            if (btn) {
                btn.remove();
            }
        }
    }

    requestData();
    setInterval(requestData, 5000);
});
