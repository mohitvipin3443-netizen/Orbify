window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data) return;

    if (event.data.source === "quest-spoofer-page") {
        chrome.runtime.sendMessage(event.data).catch(() => { });
    } else if (event.data.source === "quest-spoofer-page-settings-req") {
        // inject.js asking for user settings
        chrome.storage.local.get(['autoAccept'], (res) => {
            window.postMessage({
                source: "quest-spoofer-ext-settings",
                autoAccept: !!res.autoAccept
            }, "*");
        });
    } else if (event.data.source === "quest-spoofer-page-speed-req") {
        // inject.js asking for spoofing speed
        chrome.storage.local.get(['spoofSpeed'], (res) => {
            window.postMessage({
                source: "quest-spoofer-ext-speed",
                spoofSpeed: res.spoofSpeed || "normal"
            }, "*");
        });
    }
}, false);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.source === "quest-spoofer-ext") {
        window.postMessage(request, "*");
    }
});
