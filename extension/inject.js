(function () {
    let wpRequire;
    let ApplicationStreamingStore, RunningGameStore, QuestsStore, ChannelStore, GuildChannelStore, FluxDispatcher, api;

    let initRetries = 0;
    const MAX_INIT_RETRIES = 5;

    function init() {
        if (!window.webpackChunkdiscord_app) {
            initRetries++;
            if (initRetries >= MAX_INIT_RETRIES) {
                sendToExt({ action: "CONNECTION_ERROR", message: "Discord took too long to load. Try reloading the tab." });
                return;
            }
            return setTimeout(init, 1000);
        }

        wpRequire = window.webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
        window.webpackChunkdiscord_app.pop();

        let getStore = (filter) => {
            return Object.values(wpRequire.c).find(x => {
                try {
                    return filter(x);
                } catch (e) {
                    return false;
                }
            });
        };

        ApplicationStreamingStore = getStore(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata)?.exports?.A;
        RunningGameStore = getStore(x => x?.exports?.Ay?.getRunningGames)?.exports?.Ay;
        QuestsStore = getStore(x => x?.exports?.A?.__proto__?.getQuest)?.exports?.A;
        ChannelStore = getStore(x => x?.exports?.A?.__proto__?.getAllThreadsForParent)?.exports?.A;
        GuildChannelStore = getStore(x => x?.exports?.Ay?.getSFWDefaultChannel)?.exports?.Ay;
        FluxDispatcher = getStore(x => x?.exports?.h?.__proto__?.flushWaitQueue)?.exports?.h;
        api = getStore(x => x?.exports?.Bo?.get)?.exports?.Bo;

        if (!QuestsStore || !api) {
            initRetries++;
            if (initRetries >= MAX_INIT_RETRIES) {
                sendToExt({ action: "CONNECTION_ERROR", message: "Couldn't connect to Discord internals. Try reloading the Discord tab." });
                return;
            }
            console.error("Failed to find some modules. Retrying later.");
            setTimeout(init, 5000);
            return;
        }

        setInterval(() => checkQuests(), 30000);
        checkQuests();
    }

    const supportedTasks = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"];

    let currentSpoofQuest = null;
    let isSpoofing = false;
    let cancelSpoofFlag = false;

    // Speed presets: video (speed/interval) + activity (heartbeatInterval)
    const speedPresets = {
        safe: { speed: 3, interval: 2, heartbeatInterval: 25 },
        normal: { speed: 7, interval: 1, heartbeatInterval: 20 },
        fast: { speed: 10, interval: 0.5, heartbeatInterval: 10 }
    };

    function getSpeedSettings() {
        return new Promise((resolve) => {
            let listener = (event) => {
                if (event.source !== window || !event.data || event.data.source !== "quest-spoofer-ext-speed") return;
                window.removeEventListener("message", listener);
                const preset = speedPresets[event.data.spoofSpeed] || speedPresets.normal;
                resolve(preset);
            };
            window.addEventListener("message", listener);
            window.postMessage({ source: "quest-spoofer-page-speed-req" }, "*");
            // Fallback if no response in 2s
            setTimeout(() => {
                window.removeEventListener("message", listener);
                resolve(speedPresets.normal);
            }, 2000);
        });
    }

    function checkQuests() {
        let allQuests = [...QuestsStore.quests.values()];

        // Check if there are any quests to auto-enroll first
        let unenrolledQuests = allQuests.filter(x => {
            if (!x.userStatus?.enrolledAt && !x.userStatus?.completedAt && new Date(x.config?.expiresAt).getTime() > Date.now()) {
                const config = x.config?.taskConfig ?? x.config?.taskConfigV2;
                return config && config.tasks && supportedTasks.some(y => Object.keys(config.tasks).includes(y));
            }
            return false;
        });

        if (unenrolledQuests.length > 0) {
            let listener = (event) => {
                if (event.source !== window || !event.data || event.data.source !== "quest-spoofer-ext-settings") return;
                window.removeEventListener("message", listener);

                if (event.data.autoAccept) {
                    unenrolledQuests.forEach(x => {
                        api.post({
                            url: `/quests/${x.id}/enroll`,
                            body: { location: 11 }
                        }).then(() => {
                            console.log("Auto-enrolled in quest:", x.config.messages.questName);
                            setTimeout(checkQuests, 1500);
                        }).catch(e => console.error("Failed to auto-enroll quest", x.id, e));
                    });
                }
            };
            window.addEventListener("message", listener);
            window.postMessage({ source: "quest-spoofer-page-settings-req" }, "*");
        }

        let quests = allQuests.filter(x => {
            if (!x.userStatus?.enrolledAt) return false;
            if (x.userStatus?.completedAt) return false;
            if (new Date(x.config?.expiresAt).getTime() <= Date.now()) return false;
            const config = x.config?.taskConfig ?? x.config?.taskConfigV2;
            if (!config || !config.tasks) return false;
            return supportedTasks.some(y => Object.keys(config.tasks).includes(y));
        });

        let availableSpoofable = [];

        for (const q of quests) {
            const taskConfig = q.config.taskConfig ?? q.config.taskConfigV2;
            const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null);
            const secondsNeeded = taskConfig.tasks[taskName].target;
            const secondsDone = q.userStatus?.progress?.[taskName]?.value ?? 0;

            const info = {
                id: q.id,
                name: q.config.messages.questName,
                progress: Math.min(100, Math.floor((secondsDone / Math.max(secondsNeeded, 1)) * 100)),
                secondsDone,
                secondsNeeded,
                taskName,
                completed: !!q.userStatus?.completedAt
            };

            availableSpoofable.push(info);
        }

        // Sort by priority: WATCH_VIDEO first, then PLAY_ON_DESKTOP, then others
        const priorityMap = {
            "WATCH_VIDEO": 0,
            "WATCH_VIDEO_ON_MOBILE": 0,
            "PLAY_ON_DESKTOP": 1,
            "STREAM_ON_DESKTOP": 2,
            "PLAY_ACTIVITY": 2
        };

        availableSpoofable.sort((a, b) => (priorityMap[a.taskName] ?? 99) - (priorityMap[b.taskName] ?? 99));

        const allValidQuests = unenrolledQuests.map(q => ({ id: q.id, name: q.config.messages.questName }))
            .concat(quests.map(q => ({ id: q.id, name: q.config.messages.questName })));

        sendToExt({ action: "QUESTS_UPDATE", available: availableSpoofable, currentSpoofQuest, allValidQuests });
    }

    function sendToExt(msg) {
        window.postMessage({ source: "quest-spoofer-page", ...msg }, "*");
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data || event.data.source !== "quest-spoofer-ext") return;

        if (event.data.action === "START_SPOOF" && event.data.questId) {
            startSpoofing(event.data.questId);
        } else if (event.data.action === "GET_QUESTS") {
            if (QuestsStore) checkQuests();
        } else if (event.data.action === "CANCEL_SPOOF") {
            if (isSpoofing) {
                cancelSpoofFlag = true;
                console.log("Canceling spoof...");
            }
        }
    });

    async function startSpoofing(questId) {
        if (isSpoofing) return;

        let quest = [...QuestsStore.quests.values()].find(x => x.id === questId);
        if (!quest) {
            checkQuests();
            return;
        }

        isSpoofing = true;
        cancelSpoofFlag = false;
        currentSpoofQuest = quest.id;
        sendToExt({ action: "SPOOF_STATE_CHANGE", isSpoofing: true, questId });

        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null);
        const secondsNeeded = taskConfig.tasks[taskName].target;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
            // Get user's speed setting
            const speedConfig = await getSpeedSettings();
            const maxFuture = 10;
            const speed = speedConfig.speed;
            const interval = speedConfig.interval;

            const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
            let completed = false;

            while (true) {
                if (cancelSpoofFlag) {
                    break;
                }
                const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
                const diff = maxAllowed - secondsDone;
                const timestamp = secondsDone + speed;

                if (diff >= speed) {
                    try {
                        const res = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } });
                        completed = res.body.completed_at != null;
                        secondsDone = Math.min(secondsNeeded, timestamp);

                        const progressPx = Math.min(100, Math.floor((secondsDone / Math.max(secondsNeeded, 1)) * 100));
                        sendToExt({ action: "PROGRESS_UPDATE", questId, progress: progressPx, secondsDone, secondsNeeded });
                    } catch (e) {
                        console.error("Spoof error:", e);
                    }
                }

                if (timestamp >= secondsNeeded || completed) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
            }
            if (!completed && !cancelSpoofFlag) {
                try { await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } }); } catch (e) { }
            }
            if (cancelSpoofFlag) {
                console.log("Spoofing canceled for WATCH_VIDEO");
                finishSpoof();
                return;
            }
            sendToExt({ action: "PROGRESS_UPDATE", questId, progress: 100, completed: true, secondsNeeded });
            finishSpoof();
        } else if (taskName === "PLAY_ACTIVITY") {
            const speedConfig = await getSpeedSettings();
            const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;
            if (!channelId) {
                finishSpoof();
                return;
            }
            const streamKey = `call:${channelId}:1`;

            let completed = false;
            while (true) {
                if (cancelSpoofFlag) {
                    break;
                }
                try {
                    const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                    secondsDone = res.body.progress.PLAY_ACTIVITY.value;
                    const progressPx = Math.min(100, Math.floor((secondsDone / Math.max(secondsNeeded, 1)) * 100));
                    sendToExt({ action: "PROGRESS_UPDATE", questId, progress: progressPx, secondsDone, secondsNeeded });

                    if (secondsDone >= secondsNeeded) {
                        await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                        completed = true;
                        break;
                    }
                } catch (e) { console.error("Activity Spoof error:", e); }

                let sleepTime = speedConfig.heartbeatInterval * 1000;
                let slept = 0;
                while (slept < sleepTime) {
                    if (cancelSpoofFlag) break;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    slept += 1000;
                }
            }
            if (cancelSpoofFlag) {
                console.log("Spoofing canceled for PLAY_ACTIVITY");
                finishSpoof();
                return;
            }
            sendToExt({ action: "PROGRESS_UPDATE", questId, progress: 100, completed: true, secondsNeeded });
            finishSpoof();
        } else if (taskName === "PLAY_ON_DESKTOP") {
            const applicationId = quest.config.application.id;
            const pid = Math.floor(Math.random() * 30000) + 1000;

            api.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
                const appData = res.body[0];
                const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

                const fakeGame = {
                    cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                    exeName,
                    exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                    hidden: false,
                    isLauncher: false,
                    id: applicationId,
                    name: appData.name,
                    pid: pid,
                    pidPath: [pid],
                    processName: appData.name,
                    start: Date.now(),
                };

                const realGames = RunningGameStore.getRunningGames();
                const fakeGames = [fakeGame];
                const realGetRunningGames = RunningGameStore.getRunningGames;
                const realGetGameForPID = RunningGameStore.getGameForPID;

                RunningGameStore.getRunningGames = () => fakeGames;
                RunningGameStore.getGameForPID = (p) => fakeGames.find(x => x.pid === p);

                let originalDiscordNative = window.DiscordNative;
                if (!window.DiscordNative) {
                    window.DiscordNative = {
                        nativeModules: {
                            requireModule: (mod) => {
                                if (mod === 'discord_utils') {
                                    return { GetWindowFullscreenTypeByPid: () => 0 };
                                }
                                return {};
                            }
                        }
                    };
                }

                try {
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });
                } catch (e) {
                    console.error("Soft crash during RUNNING_GAMES_CHANGE (expected on web)", e);
                }

                let checkCancelInterval = setInterval(() => {
                    if (cancelSpoofFlag) {
                        clearInterval(checkCancelInterval);
                        RunningGameStore.getRunningGames = realGetRunningGames;
                        RunningGameStore.getGameForPID = realGetGameForPID;
                        try {
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
                        } catch (e) { }
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                        if (!originalDiscordNative && window.DiscordNative) {
                            delete window.DiscordNative;
                        }
                        console.log("Spoofing canceled for PLAY_ON_DESKTOP");
                        finishSpoof();
                    }
                }, 1000);

                let fn = data => {
                    let sDone = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);
                    const progressPx = Math.min(100, Math.floor((sDone / Math.max(secondsNeeded, 1)) * 100));
                    sendToExt({ action: "PROGRESS_UPDATE", questId, progress: progressPx, secondsDone: sDone, secondsNeeded });

                    if (sDone >= secondsNeeded) {
                        clearInterval(checkCancelInterval);
                        RunningGameStore.getRunningGames = realGetRunningGames;
                        RunningGameStore.getGameForPID = realGetGameForPID;
                        try {
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
                        } catch (e) { }
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                        if (!originalDiscordNative && window.DiscordNative) {
                            delete window.DiscordNative;
                        }
                        sendToExt({ action: "PROGRESS_UPDATE", questId, progress: 100, completed: true, secondsNeeded });
                        finishSpoof();
                    }
                };
                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
            }).catch(e => {
                console.error("Failed to fetch app data for spoof", e);
                finishSpoof();
            });
        } else if (taskName === "STREAM_ON_DESKTOP") {
            const applicationId = quest.config.application.id;
            const pid = Math.floor(Math.random() * 30000) + 1000;

            let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                id: applicationId,
                pid,
                sourceName: null
            });

            let checkCancelInterval = setInterval(() => {
                if (cancelSpoofFlag) {
                    clearInterval(checkCancelInterval);
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    console.log("Spoofing canceled for STREAM_ON_DESKTOP");
                    finishSpoof();
                }
            }, 1000);

            let fn = data => {
                let sDone = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
                const progressPx = Math.min(100, Math.floor((sDone / Math.max(secondsNeeded, 1)) * 100));
                sendToExt({ action: "PROGRESS_UPDATE", questId, progress: progressPx, secondsDone: sDone, secondsNeeded });

                if (sDone >= secondsNeeded) {
                    clearInterval(checkCancelInterval);
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    sendToExt({ action: "PROGRESS_UPDATE", questId, progress: 100, completed: true, secondsNeeded });
                    finishSpoof();
                }
            }
            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
        } else {
            console.log("Unsupported task name: " + taskName);
            finishSpoof();
        }
    }


    function finishSpoof() {
        isSpoofing = false;
        cancelSpoofFlag = false;
        currentSpoofQuest = null;
        sendToExt({ action: "SPOOF_STATE_CHANGE", isSpoofing: false });
        setTimeout(checkQuests, 1000);
    }

    setTimeout(init, 2000);
})();
