let currentProgress = 0;
let isSpoofing = false;
let autoSpoofEnabled = false;
let notificationsEnabled = true;
let knownQuestIds = new Set();
let workerTabId = null;

chrome.storage.local.get(['autoSpoof', 'knownQuests', 'notifications'], (res) => {
    autoSpoofEnabled = !!res.autoSpoof;
    notificationsEnabled = res.notifications !== false;
    if (res.knownQuests) {
        knownQuestIds = new Set(res.knownQuests);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.autoSpoof) {
        autoSpoofEnabled = changes.autoSpoof.newValue;
    }
    if (namespace === 'local' && changes.notifications) {
        notificationsEnabled = changes.notifications.newValue;
    }
});

// Track when Discord tabs are closed so we can re-elect a worker
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === workerTabId) {
        workerTabId = null;
        electWorkerTab();
    }
});

function electWorkerTab(callback) {
    chrome.tabs.query({ url: "*://*.discord.com/*" }, (tabs) => {
        if (tabs.length > 0) {
            workerTabId = tabs[0].id;
        } else {
            workerTabId = null;
        }
        if (callback) callback(workerTabId);
    });
}

function sendToWorker(message) {
    if (workerTabId) {
        chrome.tabs.sendMessage(workerTabId, { source: "quest-spoofer-ext", ...message }).catch(() => {
            // Worker tab might be dead, re-elect
            workerTabId = null;
            electWorkerTab((newId) => {
                if (newId) {
                    chrome.tabs.sendMessage(newId, { source: "quest-spoofer-ext", ...message }).catch(() => { });
                }
            });
        });
    } else {
        electWorkerTab((newId) => {
            if (newId) {
                chrome.tabs.sendMessage(newId, { source: "quest-spoofer-ext", ...message }).catch(() => { });
            }
        });
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Messages from popup
    if (request.action === "POPUP_GET_QUESTS") {
        chrome.tabs.query({ url: "*://*.discord.com/*" }, (tabs) => {
            if (tabs.length === 0) {
                chrome.runtime.sendMessage({ action: "NO_DISCORD_TABS" }).catch(() => { });
                return;
            }
            // Elect worker if not set or if current worker is gone
            if (!workerTabId || !tabs.find(t => t.id === workerTabId)) {
                workerTabId = tabs[0].id;
            }
            sendToWorker({ action: "GET_QUESTS" });
        });
        return;
    }

    if (request.action === "POPUP_START_SPOOF") {
        sendToWorker({ action: "START_SPOOF", questId: request.questId });
        return;
    }

    if (request.action === "POPUP_CANCEL_SPOOF") {
        sendToWorker({ action: "CANCEL_SPOOF" });
        return;
    }

    // Messages from content script (page)
    if (request.action === "QUESTS_UPDATE") {
        // Track worker tab from whoever sent us data
        if (sender.tab) {
            workerTabId = sender.tab.id;
        }

        if (request.allValidQuests) {
            let newlyFound = false;
            for (const quest of request.allValidQuests) {
                if (!knownQuestIds.has(quest.id)) {
                    knownQuestIds.add(quest.id);
                    newlyFound = true;
                    if (notificationsEnabled) {
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: 'icons/icon.png',
                            title: 'New Discord Quest!',
                            message: `Orbify found a new quest: ${quest.name}`
                        });
                    }
                }
            }
            if (newlyFound) {
                chrome.storage.local.set({ knownQuests: Array.from(knownQuestIds) });
            }
        }

        if (autoSpoofEnabled && !request.currentSpoofQuest && request.available && request.available.length > 0) {
            const target = request.available.find(q => q.progress < 100 && !q.completed);
            if (target && !isSpoofing) {
                sendToWorker({ action: "START_SPOOF", questId: target.id });
            }
        }
    } else if (request.action === "PROGRESS_UPDATE") {
        updateIconProgress(request.progress);
        if (request.completed) {
            // Update stats
            chrome.storage.local.get(['stats'], (res) => {
                const stats = res.stats || { questsSpoofed: 0, timeSaved: 0 };
                stats.questsSpoofed += 1;
                stats.timeSaved += (request.secondsNeeded || 0);
                chrome.storage.local.set({ stats });
                // Notify popup about stats update
                chrome.runtime.sendMessage({ action: "STATS_UPDATED", stats }).catch(() => { });
            });

            if (notificationsEnabled) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon.png',
                    title: 'Orbify',
                    message: 'A Discord quest has been successfully spoofed!'
                });
            }
            setTimeout(() => {
                isSpoofing = false;
                updateIconProgress(0);
            }, 3000);
        }
    } else if (request.action === "SPOOF_STATE_CHANGE") {
        isSpoofing = request.isSpoofing;
        if (!isSpoofing) {
            updateIconProgress(0);
        }
    } else if (request.action === "CONNECTION_ERROR") {
        // Forward to popup
        chrome.runtime.sendMessage({ action: "CONNECTION_ERROR", message: request.message }).catch(() => { });
    }
});

let cachedIconBitmap = null;

async function updateIconProgress(percentage) {
    currentProgress = percentage;

    if (percentage <= 0 || !isSpoofing) {
        chrome.action.setIcon({ path: "icons/icon.png" }).catch(() => { });
        return;
    }

    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 32, 32);

    try {
        if (!cachedIconBitmap) {
            const response = await fetch('icons/icon.png');
            const blob = await response.blob();
            cachedIconBitmap = await createImageBitmap(blob);
        }

        ctx.drawImage(cachedIconBitmap, 3, 3, 26, 26);
    } catch (e) {
        console.error("Failed to load icon", e);
    }

    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, 2 * Math.PI);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1e1f22';
    ctx.stroke();

    if (percentage > 0 && percentage < 100) {
        ctx.beginPath();
        const startAngle = -0.5 * Math.PI;
        const endAngle = startAngle + (percentage / 100) * 2 * Math.PI;
        ctx.arc(16, 16, 14, startAngle, endAngle);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#23a559';
        ctx.stroke();
    } else if (percentage >= 100) {
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, 2 * Math.PI);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#23a559';
        ctx.stroke();
    }

    const imageData = ctx.getImageData(0, 0, 32, 32);
    chrome.action.setIcon({ imageData: imageData }).catch(() => { });
}

// Initialize icon
updateIconProgress(0);
