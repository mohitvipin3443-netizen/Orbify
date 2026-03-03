# ✧ Orbify

<img src="design/icon.png" width="100" align="right" alt="Orbify Icon">

A minimalist extension designed to automate and simplify platform quests. This tool intercepts network requests and interacts with internal systems to progress through various quest types without requiring manual interaction.

> [!WARNING]
> **Use at your own risk.** Platform Terms of Service usually do not explicitly mention "quest spoofing," however, the methods used by this extension (header modification, automated API requests) fall under general rules against automation and client modification. Using this could result in your account being flagged or banned.

## Features

- **Automated Progression**: Automatically handles quest tasks in the background.
- **Multiple Task Support**: 
    - Video quests (including mobile variants).
    - Desktop play and streaming requirements.
    - Activity-based quests.
- **Auto Spoof**: Optionally start spoofing new quests automatically.
- **Auto Accept**: Automatically enroll in available quests.
- **Speed Control**: Choose between Safe, Normal, and Fast spoofing speeds.
- **Notifications**: Get notified when new quests appear or spoofing completes.
- **Hide Completed**: Toggle visibility of finished quests in the popup.
- **Lifetime Stats**: Track how many quests you've spoofed and time saved.
- **Header Spoofing**: Uses `declarativeNetRequest` to bypass environment checks by emulating the platform's desktop client.

## Supported Quest Types

- `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE`
- `PLAY_ON_DESKTOP`
- `STREAM_ON_DESKTOP`
- `PLAY_ACTIVITY`

## Installation

1. Clone or download this repository.
2. Open your browser's extension management page (e.g., `chrome://extensions/`).
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the `extension` folder within this project.

## How it Works

The extension consists of several components:
- **`manifest.json`**: Configures permissions, script injection, and icon assets.
- **`rules.json`**: Defines network rules for header modification.
- **`preload.js`**: Intercepts outbound requests early to spoof client identity headers.
- **`inject.js`**: Main logic that hooks into the platform's internal modules to drive quest progression.
- **`content.js`**: Bridges communication between the injected page scripts and the extension.
- **`background.js`**: Service worker that coordinates multi-tab handling, notifications, stats tracking, and auto-spoof logic.
- **`popup.html/js/css`**: The extension popup UI with quest list, settings, and about tabs.
