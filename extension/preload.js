// Quest Spoofer - Network Interception Layer
// We strictly avoid mocking window.DiscordNative or navigator.userAgent here
// because Discord's React application will crash if it expects native C++ modules
// on a pure Web Client. 
// Instead, we just intercept outbound traffic to spoof the backend payload!

function patchSuperProperties(value) {
    try {
        let props = JSON.parse(atob(value));
        props.browser = "Discord Client";
        props.client_version = "1.0.9143";
        props.os_version = "10.0.19045";
        props.os = "Windows";
        props.os_arch = "x64";
        props.system_locale = "en-US";
        // Do NOT touch client_build_number, the active web build is accepted!
        delete props.browser_user_agent;
        delete props.browser_version;
        return btoa(JSON.stringify(props));
    } catch (e) {
        console.error("[Quest Spoofer] Failed to modify X-Super-Properties", e);
        return value;
    }
}

// 1. Intercept X-Super-Properties on XHR requests
const originalOpen = XMLHttpRequest.prototype.open;
const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
};

XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (header.toLowerCase() === 'x-super-properties') {
        if (!this._url || (!this._url.includes('/claim-reward'))) {
            value = patchSuperProperties(value);
        }
    }
    return originalSetRequestHeader.apply(this, arguments);
};

// 2. Intercept fetch API calls (modern Discord endpoints often use fetch)
const originalFetch = window.fetch;
window.fetch = async function (resource, config) {
    let url = "";
    if (typeof resource === 'string') {
        url = resource;
    } else if (resource instanceof URL) {
        url = resource.href;
    } else if (resource instanceof Request) {
        url = resource.url;
    }

    if (!url.includes('/claim-reward') && config && config.headers) {
        if (config.headers instanceof Headers) {
            if (config.headers.has('X-Super-Properties')) {
                config.headers.set('X-Super-Properties', patchSuperProperties(config.headers.get('X-Super-Properties')));
            } else if (config.headers.has('x-super-properties')) {
                config.headers.set('x-super-properties', patchSuperProperties(config.headers.get('x-super-properties')));
            }
        } else if (typeof config.headers === 'object') {
            for (let key in config.headers) {
                if (key.toLowerCase() === 'x-super-properties') {
                    config.headers[key] = patchSuperProperties(config.headers[key]);
                }
            }
        }
    }
    return originalFetch.apply(this, arguments);
};

// 3. Intercept WebSocket Identify Payload
const originalSend = window.WebSocket.prototype.send;
window.WebSocket.prototype.send = function (data) {
    if (typeof data === 'string') {
        if (data.includes('"op":2') && data.includes('"$browser"')) {
            try {
                let parsed = JSON.parse(data);
                if (parsed.op === 2 && parsed.d && parsed.d.properties) {
                    parsed.d.properties.$browser = "Discord Client";
                    parsed.d.properties.$device = "";
                    parsed.d.properties.$os_version = "10.0.19045";
                    parsed.d.properties.$os = "Windows";
                    delete parsed.d.properties.$browser_user_agent;
                    delete parsed.d.properties.$browser_version;
                    data = JSON.stringify(parsed);
                }
            } catch (e) {
                console.error("[Quest Spoofer] Failed to modify Identify payload", e);
            }
        }
    }
    return originalSend.apply(this, arguments);
};

console.log("[Quest Spoofer] Invisible Network Interceptors active.");
