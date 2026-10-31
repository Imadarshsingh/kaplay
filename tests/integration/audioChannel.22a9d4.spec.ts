import { expect, type Page, test } from "@playwright/test";

async function installAudioProbe(page: Page) {
    await page.addScriptTag({ path: "dist/kaplay.js" });
    await page.evaluate(() => {
        class ProbeParam {
            value: number;

            constructor(value: number) {
                this.value = value;
            }
        }

        class ProbeNode {
            outputs: ProbeNode[] = [];

            connect(node: ProbeNode) {
                this.outputs.push(node);
                return node;
            }

            disconnect(node?: ProbeNode) {
                if (node) {
                    this.outputs = this.outputs.filter((output) =>
                        output !== node
                    );
                }
                else {
                    this.outputs = [];
                }
            }
        }

        class ProbeGainNode extends ProbeNode {
            gain = new ProbeParam(1);
        }

        class ProbePannerNode extends ProbeNode {
            pan = new ProbeParam(0);
        }

        class ProbeBufferSourceNode extends ProbeNode {
            buffer: any = null;
            loop = false;
            playbackRate = new ProbeParam(1);
            detune = new ProbeParam(0);
            onended: (() => void) | null = null;
            startOffsets: number[] = [];
            starts = 0;
            stops = 0;

            start(_when: number = 0, offset: number = 0) {
                this.starts++;
                this.startOffsets.push(offset);
            }

            stop() {
                this.stops++;
            }
        }

        class ProbeMediaElementSourceNode extends ProbeNode {
            element: HTMLAudioElement;

            constructor(element: HTMLAudioElement) {
                super();
                this.element = element;
            }
        }

        class ProbeAudioContext {
            static instances: ProbeAudioContext[] = [];
            currentTime = 0;
            destination = new ProbeNode();
            bufferSources: ProbeBufferSourceNode[] = [];
            mediaSources: ProbeMediaElementSourceNode[] = [];

            constructor() {
                ProbeAudioContext.instances.push(this);
            }

            createGain() {
                return new ProbeGainNode();
            }

            createStereoPanner() {
                return new ProbePannerNode();
            }

            createBufferSource() {
                const source = new ProbeBufferSourceNode();
                this.bufferSources.push(source);
                return source;
            }

            createMediaElementSource(element: HTMLAudioElement) {
                const source = new ProbeMediaElementSourceNode(element);
                this.mediaSources.push(source);
                return source;
            }

            createBuffer(
                numberOfChannels: number,
                length: number,
                sampleRate: number,
            ) {
                const channels = Array.from(
                    { length: numberOfChannels },
                    () => new Float32Array(length),
                );

                return {
                    duration: length / sampleRate,
                    length,
                    numberOfChannels,
                    sampleRate,
                    getChannelData(index: number) {
                        return channels[index];
                    },
                };
            }

            decodeAudioData(
                _data: ArrayBuffer,
                success?: (buffer: any) => void,
            ) {
                const buffer = this.createBuffer(1, 8, 8);
                success?.(buffer);
                return Promise.resolve(buffer);
            }

            resume() {
                return Promise.resolve();
            }

            suspend() {
                return Promise.resolve();
            }

            close() {
                return Promise.resolve();
            }

            levelFrom(source: ProbeNode) {
                const visit = (
                    node: ProbeNode,
                    level: number,
                    path: Set<ProbeNode>,
                ): number => {
                    if (path.has(node)) return 0;

                    const nextPath = new Set(path);
                    nextPath.add(node);

                    if (node instanceof ProbeGainNode) {
                        level *= node.gain.value;
                    }
                    if (node instanceof ProbeMediaElementSourceNode) {
                        level *= node.element.volume;
                    }
                    if (node === this.destination) return level;

                    return node.outputs.reduce(
                        (sum, output) => sum + visit(output, level, nextPath),
                        0,
                    );
                };

                return visit(source, 1, new Set());
            }
        }

        Object.defineProperty(window, "AudioContext", {
            configurable: true,
            value: ProbeAudioContext,
            writable: true,
        });
        Object.defineProperty(window, "webkitAudioContext", {
            configurable: true,
            value: ProbeAudioContext,
            writable: true,
        });

        const mediaPaused = new WeakMap<HTMLMediaElement, boolean>();
        const mediaPlayCount = new WeakMap<HTMLMediaElement, number>();
        Object.defineProperty(HTMLMediaElement.prototype, "paused", {
            configurable: true,
            get() {
                return mediaPaused.get(this) ?? true;
            },
        });
        HTMLMediaElement.prototype.play = function() {
            mediaPaused.set(this, false);
            mediaPlayCount.set(this, (mediaPlayCount.get(this) ?? 0) + 1);
            return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function() {
            mediaPaused.set(this, true);
        };

        (window as any).__audioProbe = {
            context() {
                return ProbeAudioContext.instances.at(-1)!;
            },
            endBuffer(source: ProbeBufferSourceNode) {
                source.onended?.();
            },
            endMedia(source: ProbeMediaElementSourceNode) {
                mediaPaused.set(source.element, true);
                source.element.dispatchEvent(new Event("ended"));
            },
            mediaPlayCount(source: ProbeMediaElementSourceNode) {
                return mediaPlayCount.get(source.element) ?? 0;
            },
        };
    });
}

test.beforeEach(async ({ page }) => {
    await installAudioProbe(page);
});

test.describe("@audio-channel live audio channels", () => {
    test("creates mutable channels with documented defaults and volume bounds", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const defaults = k.createAudioChannel();
            const configured = k.createAudioChannel({
                muted: true,
                paused: true,
                volume: 0.25,
            });
            const negativeInitial = k.createAudioChannel({ volume: -0.01 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const initial = {
                defaultsMuted: defaults.muted,
                defaultsPaused: defaults.paused,
                defaultsVolume: defaults.volume,
                muted: configured.muted,
                paused: configured.paused,
                volume: configured.volume,
            };
            configured.paused = false;
            k.play(sound, { channel: configured });
            const initiallyMutedLevel = probe.levelFrom(
                probe.bufferSources.at(-1),
            );

            configured.volume = -0.01;
            const belowZero = configured.volume;
            configured.volume = 0;
            const exactlyZero = configured.volume;
            configured.volume = 1.5;
            const aboveOne = configured.volume;

            return {
                aboveOne,
                belowZero,
                exactlyZero,
                initial,
                initiallyMutedLevel,
                negativeInitial: negativeInitial.volume,
            };
        });

        expect(result.initial).toEqual({
            defaultsMuted: false,
            defaultsPaused: false,
            defaultsVolume: 1,
            muted: true,
            paused: true,
            volume: 0.25,
        });
        expect(result.belowZero).toBe(0);
        expect(result.negativeInitial).toBe(0);
        expect(result.exactlyZero).toBe(0);
        expect(result.aboveOne).toBe(1.5);
        expect(result.initiallyMutedLevel).toBe(0);
    });

    test("applies channel volume boundaries to routed playback", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const channel = k.createAudioChannel({ volume: 0 });

            k.play(sound, { channel, volume: 0.5 });
            const source = probe.bufferSources.at(-1);
            const exactlyZero = probe.levelFrom(source);

            channel.volume = 1.5;
            const aboveOne = probe.levelFrom(source);
            channel.volume = -0.01;
            const assignedBelowZero = probe.levelFrom(source);

            const negativeInitial = k.createAudioChannel({ volume: -0.01 });
            k.play(sound, {
                channel: negativeInitial,
                volume: 0.5,
            });
            const initialBelowZero = probe.levelFrom(
                probe.bufferSources.at(-1),
            );

            return {
                aboveOne,
                assignedBelowZero,
                exactlyZero,
                initialBelowZero,
            };
        });

        expect(result.exactlyZero).toBe(0);
        expect(result.aboveOne).toBeCloseTo(0.75);
        expect(result.assignedBelowZero).toBe(0);
        expect(result.initialBelowZero).toBe(0);
    });

    test("composes buffered playback, channel, and master volume independently", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.5 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));

            k.setVolume(0.25);
            const playback = k.play(sound, {
                channel,
                volume: 0.4,
            });
            const source = probe.bufferSources.at(-1);
            const initial = probe.levelFrom(source);

            playback.volume = 0.8;
            const afterPlayback = probe.levelFrom(source);
            channel.volume = 0.25;
            const afterChannel = probe.levelFrom(source);
            k.setVolume(0.5);
            const afterMaster = probe.levelFrom(source);

            return {
                afterChannel,
                afterMaster,
                afterPlayback,
                channelVolume: channel.volume,
                initial,
                masterVolume: k.getVolume(),
                playbackVolume: playback.volume,
            };
        });

        expect(result.initial).toBeCloseTo(0.05);
        expect(result.afterPlayback).toBeCloseTo(0.1);
        expect(result.afterChannel).toBeCloseTo(0.05);
        expect(result.afterMaster).toBeCloseTo(0.1);
        expect(result.playbackVolume).toBe(0.8);
        expect(result.channelVolume).toBe(0.25);
        expect(result.masterVolume).toBe(0.5);
    });

    test("preserves channel volume while muted for current and future sounds", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.6 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const first = k.play(sound, {
                channel,
                volume: 0.5,
            });
            const firstSource = probe.bufferSources.at(-1);

            channel.muted = true;
            const mutedCurrent = probe.levelFrom(firstSource);
            const mutedProperty = channel.muted;
            channel.volume = 0.2;
            const storedWhileMuted = channel.volume;

            const second = k.play(sound, {
                channel,
                volume: 0.25,
            });
            const secondSource = probe.bufferSources.at(-1);
            const mutedFuture = probe.levelFrom(secondSource);

            channel.muted = false;
            const unmutedProperty = channel.muted;
            const restoredCurrent = probe.levelFrom(firstSource);
            const restoredFuture = probe.levelFrom(secondSource);

            return {
                firstVolume: first.volume,
                mutedCurrent,
                mutedFuture,
                mutedProperty,
                restoredCurrent,
                restoredFuture,
                secondVolume: second.volume,
                storedWhileMuted,
                unmutedProperty,
            };
        });

        expect(result.mutedCurrent).toBe(0);
        expect(result.mutedFuture).toBe(0);
        expect(result.mutedProperty).toBe(true);
        expect(result.storedWhileMuted).toBe(0.2);
        expect(result.restoredCurrent).toBeCloseTo(0.1);
        expect(result.restoredFuture).toBeCloseTo(0.05);
        expect(result.firstVolume).toBe(0.5);
        expect(result.secondVolume).toBe(0.25);
        expect(result.unmutedProperty).toBe(false);
    });

    test("composes channel pause with current, future, and per-play pause state", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const running = k.play(sound, { channel });
            const individuallyPaused = k.play(sound, {
                channel,
                paused: true,
            });
            const startsBeforePause = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );

            channel.paused = true;
            const stoppedByChannel = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.stops,
                0,
            );
            const future = k.play(sound, { channel });
            future.play(2);
            const setterFuture = k.play(sound, {
                channel,
                paused: true,
            });
            setterFuture.paused = false;
            const startsWhilePaused = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            const pausedStates = {
                channel: channel.paused,
                future: future.paused,
                individuallyPaused: individuallyPaused.paused,
                running: running.paused,
                setterFuture: setterFuture.paused,
            };

            channel.paused = false;
            const resumedStates = {
                channel: channel.paused,
                future: future.paused,
                individuallyPaused: individuallyPaused.paused,
                running: running.paused,
                setterFuture: setterFuture.paused,
            };
            const startsAfterResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );

            return {
                pausedStates,
                resumedStates,
                startsAfterResume,
                startsBeforePause,
                startsWhilePaused,
                stoppedByChannel,
            };
        });

        expect(result.startsBeforePause).toBe(1);
        expect(result.stoppedByChannel).toBe(1);
        expect(result.startsWhilePaused).toBe(1);
        expect(result.pausedStates).toEqual({
            channel: true,
            future: true,
            individuallyPaused: true,
            running: true,
            setterFuture: true,
        });
        expect(result.resumedStates).toEqual({
            channel: false,
            future: false,
            individuallyPaused: true,
            running: false,
            setterFuture: false,
        });
        expect(result.startsAfterResume).toBe(4);
    });

    test("applies channel pause semantics to streamed music", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ paused: true });
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", { channel });
            const source = probe.mediaSources.at(-1);
            const initiallyPaused = {
                element: source.element.paused,
                playback: playback.paused,
            };

            playback.play();
            const afterPlayWhilePaused = playback.paused;
            const setterPlayback = k.play("track", {
                channel,
                paused: true,
            });
            const setterSource = probe.mediaSources.at(-1);
            setterPlayback.paused = false;
            const afterSetterWhilePaused = {
                element: setterSource.element.paused,
                playback: setterPlayback.paused,
            };
            channel.paused = false;
            const afterChannelResume = {
                element: source.element.paused,
                playback: playback.paused,
                setterElement: setterSource.element.paused,
                setterPlayback: setterPlayback.paused,
            };
            channel.paused = true;
            playback.paused = true;
            channel.paused = false;

            return {
                afterChannelResume,
                afterPlayWhilePaused,
                afterSetterWhilePaused,
                initiallyPaused,
                independentlyPaused: playback.paused,
            };
        });

        expect(result.initiallyPaused).toEqual({
            element: true,
            playback: true,
        });
        expect(result.afterPlayWhilePaused).toBe(true);
        expect(result.afterSetterWhilePaused).toEqual({
            element: true,
            playback: true,
        });
        expect(result.afterChannelResume).toEqual({
            element: false,
            playback: false,
            setterElement: false,
            setterPlayback: false,
        });
        expect(result.independentlyPaused).toBe(true);
    });

    test("does not restart completed music when channel state changes", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const channel = k.createAudioChannel();
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", { channel });
            const source = probe.context().mediaSources.at(-1);
            const initialPlayCount = probe.mediaPlayCount(source);

            probe.endMedia(source);
            channel.paused = true;
            playback.seek(4);
            const timeAfterCompletedSeek = playback.time();
            channel.paused = false;
            const playCountAfterChannelResume = probe.mediaPlayCount(source);
            playback.play(4);

            return {
                explicitReplayCount: probe.mediaPlayCount(source),
                explicitReplayTime: playback.time(),
                initialPlayCount,
                playCountAfterChannelResume,
                timeAfterCompletedSeek,
            };
        });

        expect(result).toEqual({
            explicitReplayCount: 2,
            explicitReplayTime: 4,
            initialPlayCount: 1,
            playCountAfterChannelResume: 1,
            timeAfterCompletedSeek: 4,
        });
    });

    test("preserves a streamed start offset while its channel is paused", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const channel = k.createAudioChannel({ paused: true });
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", { channel, seek: 3 });
            const source = probe.context().mediaSources.at(-1);

            const beforePlay = {
                paused: playback.paused,
                plays: probe.mediaPlayCount(source),
                time: playback.time(),
            };
            playback.play();
            const beforeResume = {
                paused: playback.paused,
                plays: probe.mediaPlayCount(source),
                time: playback.time(),
            };
            channel.paused = false;

            return {
                afterResume: {
                    paused: playback.paused,
                    plays: probe.mediaPlayCount(source),
                    time: playback.time(),
                },
                beforePlay,
                beforeResume,
            };
        });

        expect(result).toEqual({
            afterResume: { paused: false, plays: 1, time: 3 },
            beforePlay: { paused: true, plays: 0, time: 3 },
            beforeResume: { paused: true, plays: 0, time: 3 },
        });
    });

    test("replays completed streamed music from an offset after channel resume", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const channel = k.createAudioChannel();
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", { channel });
            const source = probe.context().mediaSources.at(-1);

            probe.endMedia(source);
            channel.paused = true;
            playback.play(4);
            const queued = {
                paused: playback.paused,
                plays: probe.mediaPlayCount(source),
                time: playback.time(),
            };
            channel.paused = false;

            return {
                afterResume: {
                    paused: playback.paused,
                    plays: probe.mediaPlayCount(source),
                    time: playback.time(),
                },
                queued,
            };
        });

        expect(result).toEqual({
            afterResume: { paused: false, plays: 2, time: 4 },
            queued: { paused: true, plays: 1, time: 4 },
        });
    });

    test("keeps replayed streamed music assigned after channel stop", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const channel = k.createAudioChannel({ volume: 0.5 });
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", {
                channel,
                volume: 0.5,
            });
            const source = probe.context().mediaSources.at(-1);

            channel.stop();
            playback.play(4);
            channel.volume = 0.25;
            const afterReplay = {
                level: probe.context().levelFrom(source),
                paused: playback.paused,
                plays: probe.mediaPlayCount(source),
                time: playback.time(),
            };

            channel.paused = true;
            channel.muted = true;
            const whilePausedAndMuted = {
                level: probe.context().levelFrom(source),
                paused: playback.paused,
            };

            channel.paused = false;
            channel.muted = false;

            return {
                afterReplay,
                afterResume: {
                    level: probe.context().levelFrom(source),
                    paused: playback.paused,
                    plays: probe.mediaPlayCount(source),
                    time: playback.time(),
                },
                whilePausedAndMuted,
            };
        });

        expect(result.afterReplay.paused).toBe(false);
        expect(result.afterReplay.plays).toBe(2);
        expect(result.afterReplay.time).toBe(4);
        expect(result.afterReplay.level).toBeCloseTo(0.125);
        expect(result.whilePausedAndMuted).toEqual({
            level: 0,
            paused: true,
        });
        expect(result.afterResume.paused).toBe(false);
        expect(result.afterResume.plays).toBe(3);
        expect(result.afterResume.time).toBe(4);
        expect(result.afterResume.level).toBeCloseTo(0.125);
    });

    test("stops the current channel cohort including unresolved playback", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const unpausedChannel = k.createAudioChannel();
            k.play(sound, { channel: unpausedChannel });
            unpausedChannel.stop();
            const unpausedAfterStop = unpausedChannel.paused;
            const channel = k.createAudioChannel();
            const buffered = k.play(sound, { channel });
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const music = k.play("track", { channel });
            let resolveAsset: (sound: any) => void = () => {};
            const asset = new k.Asset(
                new Promise((resolve) => {
                    resolveAsset = resolve;
                }),
            );
            const pending = k.play(asset, { channel });

            channel.paused = true;
            channel.stop();
            const pausedAfterStop = channel.paused;
            const startsBeforePendingResolve = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            resolveAsset(sound);
            await Promise.resolve();
            await Promise.resolve();
            const startsAfterPendingResolve = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            const futureBuffered = k.play(sound, { channel });
            const futureMusic = k.play("track", { channel });
            const startsBeforeFutureResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            const futureBeforeResume = {
                buffered: futureBuffered.paused,
                bufferedStarts: startsBeforeFutureResume
                    - startsAfterPendingResolve,
                music: futureMusic.paused,
            };
            channel.paused = false;
            const futureBufferedStarts = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            ) - startsBeforeFutureResume;
            const futureAfterResume = {
                buffered: futureBuffered.paused,
                bufferedStarts: futureBufferedStarts,
                music: futureMusic.paused,
            };
            channel.stop();
            const futureAfterSecondStop = {
                buffered: futureBuffered.paused,
                music: futureMusic.paused,
            };

            return {
                channelPaused: channel.paused,
                current: {
                    buffered: buffered.paused,
                    music: music.paused,
                    pending: pending.paused,
                },
                future: futureAfterResume,
                futureAfterSecondStop,
                futureBeforeResume,
                pendingStarts: startsAfterPendingResolve
                    - startsBeforePendingResolve,
                pausedAfterStop,
                unpausedAfterStop,
            };
        });

        expect(result.unpausedAfterStop).toBe(false);
        expect(result.channelPaused).toBe(false);
        expect(result.pausedAfterStop).toBe(true);
        expect(result.current).toEqual({
            buffered: true,
            music: true,
            pending: true,
        });
        expect(result.pendingStarts).toBe(0);
        expect(result.futureBeforeResume).toEqual({
            buffered: true,
            bufferedStarts: 0,
            music: true,
        });
        expect(result.future).toEqual({
            buffered: false,
            bufferedStarts: 1,
            music: false,
        });
        expect(result.futureAfterSecondStop).toEqual({
            buffered: true,
            music: true,
        });
    });

    test("detaching while channel-paused removes volume and transport control", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const channel = k.createAudioChannel({ paused: true, volume: 0.2 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const buffered = k.play(sound, { channel });
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const music = k.play("track", { channel });
            const custom = k.audioCtx.createGain();
            custom.connect(k.audioCtx.destination);

            const beforeDetach = {
                buffered: buffered.paused,
                music: music.paused,
            };
            buffered.connect(custom);
            music.connect(custom);
            const afterDetach = {
                buffered: buffered.paused,
                music: music.paused,
            };

            channel.stop();
            channel.paused = false;
            channel.paused = true;
            buffered.connect();
            music.connect();

            return {
                afterChannelChanges: {
                    buffered: buffered.paused,
                    music: music.paused,
                },
                afterDetach,
                beforeDetach,
            };
        });

        expect(result.beforeDetach).toEqual({ buffered: true, music: true });
        expect(result.afterDetach).toEqual({ buffered: false, music: false });
        expect(result.afterChannelChanges).toEqual({
            buffered: false,
            music: false,
        });
    });

    test("detaches unresolved playback from later channel state", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ paused: true, volume: 0.2 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            let resolveAsset: (sound: any) => void = () => {};
            const asset = new k.Asset(
                new Promise((resolve) => {
                    resolveAsset = resolve;
                }),
            );
            const playback = k.play(asset, { channel, volume: 0.5 });
            const custom = k.audioCtx.createGain();
            custom.gain.value = 0.4;
            custom.connect(k.audioCtx.destination);

            playback.connect(custom);
            channel.stop();
            channel.paused = false;
            channel.paused = true;
            channel.volume = 0.9;
            const startsBeforeResolve = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            resolveAsset(sound);
            await Promise.resolve();
            await Promise.resolve();
            const resolvedSource = probe.bufferSources.at(-1);

            return {
                level: probe.levelFrom(resolvedSource),
                paused: playback.paused,
                starts: probe.bufferSources.reduce(
                    (total: number, source: any) => total + source.starts,
                    0,
                ) - startsBeforeResolve,
            };
        });

        expect(result).toEqual({
            level: 0.2,
            paused: false,
            starts: 1,
        });
    });

    test("isolates separate channels and leaves unassigned playback on master volume", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const firstChannel = k.createAudioChannel({ volume: 0.5 });
            const secondChannel = k.createAudioChannel({ volume: 0.25 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));

            k.setVolume(0.5);
            const first = k.play(sound, { channel: firstChannel });
            const firstSource = probe.bufferSources.at(-1);
            const second = k.play(sound, { channel: secondChannel });
            const secondSource = probe.bufferSources.at(-1);
            const unassigned = k.play(sound, { volume: 0.75 });
            const unassignedSource = probe.bufferSources.at(-1);
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const firstMusic = k.play("track", { channel: firstChannel });
            const firstMusicSource = probe.mediaSources.at(-1);
            const secondMusic = k.play("track", { channel: secondChannel });
            const secondMusicSource = probe.mediaSources.at(-1);
            const unassignedMusic = k.play("track");
            const unassignedMusicSource = probe.mediaSources.at(-1);

            firstChannel.volume = 0.2;
            firstChannel.paused = true;
            const whileFirstPaused = {
                first: first.paused,
                firstMusic: firstMusic.paused,
                second: second.paused,
                secondMusic: secondMusic.paused,
                unassigned: unassigned.paused,
                unassignedMusic: unassignedMusic.paused,
            };
            firstChannel.stop();
            firstChannel.paused = false;

            return {
                afterFirstStop: {
                    first: first.paused,
                    firstMusic: firstMusic.paused,
                    second: second.paused,
                    secondMusic: secondMusic.paused,
                    unassigned: unassigned.paused,
                    unassignedMusic: unassignedMusic.paused,
                },
                first: probe.levelFrom(firstSource),
                firstMusic: probe.levelFrom(firstMusicSource),
                second: probe.levelFrom(secondSource),
                secondMusic: probe.levelFrom(secondMusicSource),
                unassigned: probe.levelFrom(unassignedSource),
                unassignedMusic: probe.levelFrom(unassignedMusicSource),
                whileFirstPaused,
            };
        });

        expect(result.first).toBeCloseTo(0.1);
        expect(result.firstMusic).toBeCloseTo(0.1);
        expect(result.second).toBeCloseTo(0.125);
        expect(result.secondMusic).toBeCloseTo(0.125);
        expect(result.unassigned).toBeCloseTo(0.375);
        expect(result.unassignedMusic).toBeCloseTo(0.5);
        expect(result.whileFirstPaused).toEqual({
            first: true,
            firstMusic: true,
            second: false,
            secondMusic: false,
            unassigned: false,
            unassignedMusic: false,
        });
        expect(result.afterFirstStop).toEqual({
            first: true,
            firstMusic: true,
            second: false,
            secondMusic: false,
            unassigned: false,
            unassignedMusic: false,
        });
    });

    test("applies the same live channel behavior to streamed music", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.5 });

            k.setVolume(0.5);
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const playback = k.play("track", {
                channel,
                paused: true,
                volume: 0.4,
            });
            const source = probe.mediaSources.at(-1);
            const initial = probe.levelFrom(source);

            channel.volume = 0.25;
            const afterChannel = probe.levelFrom(source);
            playback.volume = 0.8;
            const afterPlayback = probe.levelFrom(source);
            channel.muted = true;
            const muted = probe.levelFrom(source);
            const future = k.play("track", {
                channel,
                paused: true,
                volume: 0.4,
            });
            const futureSource = probe.mediaSources.at(-1);
            const mutedFuture = probe.levelFrom(futureSource);
            channel.muted = false;
            const restored = probe.levelFrom(source);
            const restoredFuture = probe.levelFrom(futureSource);
            channel.volume = 0;
            const zeroVolume = probe.levelFrom(source);
            channel.volume = 1.5;
            const amplified = probe.levelFrom(source);

            return {
                amplified,
                afterChannel,
                afterPlayback,
                initial,
                muted,
                mutedFuture,
                playbackVolume: playback.volume,
                restored,
                restoredFuture,
                futureVolume: future.volume,
                zeroVolume,
            };
        });

        expect(result.initial).toBeCloseTo(0.1);
        expect(result.afterChannel).toBeCloseTo(0.05);
        expect(result.afterPlayback).toBeCloseTo(0.1);
        expect(result.muted).toBe(0);
        expect(result.mutedFuture).toBe(0);
        expect(result.restored).toBeCloseTo(0.1);
        expect(result.restoredFuture).toBeCloseTo(0.05);
        expect(result.zeroVolume).toBe(0);
        expect(result.amplified).toBeCloseTo(0.6);
        expect(result.playbackVolume).toBe(0.8);
        expect(result.futureVolume).toBe(0.4);
    });

    test("retains channel volume and pause when a sound asset resolves after play", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.5 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            let resolveAsset: (sound: any) => void = () => {};
            const asset = new k.Asset(
                new Promise((resolve) => {
                    resolveAsset = resolve;
                }),
            );

            const playback = k.play(asset, {
                channel,
                volume: 0.5,
            });
            channel.volume = 0.2;
            channel.paused = true;
            resolveAsset(sound);
            await Promise.resolve();
            await Promise.resolve();

            const pausedAfterLoad = playback.paused;
            playback.play();
            const startsBeforeResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            channel.paused = false;
            const resumedSource = probe.bufferSources.at(-1);
            const startsAfterResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );

            return {
                level: probe.levelFrom(resumedSource),
                pausedAfterLoad,
                startsAfterResume,
                startsBeforeResume,
                volume: playback.volume,
            };
        });

        expect(result.level).toBeCloseTo(0.1);
        expect(result.pausedAfterLoad).toBe(true);
        expect(result.startsBeforeResume).toBe(0);
        expect(result.startsAfterResume).toBe(1);
        expect(result.volume).toBe(0.5);
    });

    test("retains play and seek offsets requested while paused assets load", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            probe.currentTime = 10;
            const channel = k.createAudioChannel({ paused: true });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            let resolvePlayAsset: (sound: any) => void = () => {};
            let resolveSeekAsset: (sound: any) => void = () => {};
            const playAsset = new k.Asset(
                new Promise((resolve) => {
                    resolvePlayAsset = resolve;
                }),
            );
            const seekAsset = new k.Asset(
                new Promise((resolve) => {
                    resolveSeekAsset = resolve;
                }),
            );
            const played = k.play(playAsset, { channel });
            const sought = k.play(seekAsset, { channel });

            played.play(3);
            sought.seek(4);
            resolvePlayAsset(sound);
            resolveSeekAsset(sound);
            await Promise.resolve();
            await Promise.resolve();
            const startsBeforeResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            const pausedBeforeResume = [played.paused, sought.paused];
            probe.currentTime = 20;
            channel.paused = false;

            return {
                offsets: probe.bufferSources.flatMap((source: any) =>
                    source.startOffsets
                ).sort((a: number, b: number) => a - b),
                pausedBeforeResume,
                startsBeforeResume,
            };
        });

        expect(result.startsBeforeResume).toBe(0);
        expect(result.pausedBeforeResume).toEqual([true, true]);
        expect(result.offsets).toEqual([3, 4]);
    });

    test("starts queued buffered sounds from the beginning after a nonzero-clock pause", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            probe.currentTime = 10;

            const channel = k.createAudioChannel({ paused: true });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 8, 8));
            const ready = k.play(sound, { channel });
            let resolveAsset: (sound: any) => void = () => {};
            const asset = new k.Asset(
                new Promise((resolve) => {
                    resolveAsset = resolve;
                }),
            );
            const pending = k.play(asset, { channel });

            resolveAsset(sound);
            await Promise.resolve();
            await Promise.resolve();

            const startsWhilePaused = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            const pausedBeforeResume = [ready.paused, pending.paused];
            channel.paused = false;
            const offsets = probe.bufferSources.flatMap((source: any) =>
                source.startOffsets
            );

            return { offsets, pausedBeforeResume, startsWhilePaused };
        });

        expect(result.pausedBeforeResume).toEqual([true, true]);
        expect(result.startsWhilePaused).toBe(0);
        expect(result.offsets).toEqual([0, 0]);
    });

    test("keeps channel routing across pause, resume, and seek", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.4 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const playback = k.play(sound, { channel, volume: 0.5 });

            const initial = probe.levelFrom(probe.bufferSources.at(-1));
            playback.paused = true;
            channel.volume = 0.2;
            playback.paused = false;
            const afterResume = probe.levelFrom(probe.bufferSources.at(-1));
            playback.seek(2);
            const seekSource = probe.bufferSources.at(-1);
            const afterSeek = probe.levelFrom(seekSource);
            const seekOffset = seekSource.startOffsets.at(-1);

            return { afterResume, afterSeek, initial, seekOffset };
        });

        expect(result.initial).toBeCloseTo(0.2);
        expect(result.afterResume).toBeCloseTo(0.1);
        expect(result.afterSeek).toBeCloseTo(0.1);
        expect(result.seekOffset).toBe(2);
    });

    test("preserves playback position through channel pause, seek, stop, and replay", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            probe.currentTime = 10;
            const channel = k.createAudioChannel({ volume: 0.5 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 160, 8));
            const playback = k.play(sound, {
                channel,
                seek: 2,
                volume: 0.5,
            });
            const initialOffset = probe.bufferSources.flatMap(
                (source: any) => source.startOffsets,
            ).at(-1);

            probe.currentTime = 13;
            channel.paused = true;
            const positionAtPause = playback.time();
            probe.currentTime = 20;
            const positionWhilePaused = playback.time();
            playback.seek(7);
            const positionAfterPausedSeek = playback.time();
            const startsBeforeResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            channel.paused = false;
            const resumeSource = probe.bufferSources.at(-1);
            const resumeOffset = resumeSource.startOffsets.at(-1);
            const startsAfterResume = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );

            channel.stop();
            channel.paused = true;
            playback.play(4);
            channel.volume = 0.25;
            const startsBeforeReplay = probe.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            channel.paused = false;
            const replaySource = probe.bufferSources.at(-1);

            return {
                initialOffset,
                positionAfterPausedSeek,
                positionAtPause,
                positionWhilePaused,
                replayLevel: probe.levelFrom(replaySource),
                replayOffset: replaySource.startOffsets.at(-1),
                replayStarts: probe.bufferSources.reduce(
                    (total: number, source: any) => total + source.starts,
                    0,
                ) - startsBeforeReplay,
                resumeOffset,
                resumeStarts: startsAfterResume - startsBeforeResume,
            };
        });

        expect(result).toEqual({
            initialOffset: 2,
            positionAfterPausedSeek: 7,
            positionAtPause: 5,
            positionWhilePaused: 5,
            replayLevel: 0.125,
            replayOffset: 4,
            replayStarts: 1,
            resumeOffset: 7,
            resumeStarts: 1,
        });
    });

    test("preserves buffered position across playback-rate changes and channel pauses", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 160, 8));
            const playback = k.play(sound, {
                channel,
                seek: 1,
                speed: 2,
            });

            probe.currentTime = 1;
            const afterInitialRate = playback.time();
            playback.speed = 0.5;
            probe.currentTime = 3;
            const afterSpeedChange = playback.time();
            playback.detune = 1200;
            probe.currentTime = 4;
            channel.paused = true;
            const positionAtPause = playback.time();

            probe.currentTime = 9;
            const positionWhilePaused = playback.time();
            channel.paused = false;
            const firstResumeOffset = probe.bufferSources.at(-1)
                .startOffsets.at(-1);

            playback.speed = 0;
            playback.detune = 0;
            probe.currentTime = 12;
            channel.paused = true;
            const positionAtZeroRate = playback.time();
            channel.paused = false;
            const zeroRateResumeOffset = probe.bufferSources.at(-1)
                .startOffsets.at(-1);

            return {
                afterInitialRate,
                afterSpeedChange,
                firstResumeOffset,
                positionAtPause,
                positionAtZeroRate,
                positionWhilePaused,
                zeroRateResumeOffset,
            };
        });

        expect(result.afterInitialRate).toBeCloseTo(3);
        expect(result.afterSpeedChange).toBeCloseTo(4);
        expect(result.positionAtPause).toBeCloseTo(5);
        expect(result.positionWhilePaused).toBeCloseTo(5);
        expect(result.firstResumeOffset).toBeCloseTo(5);
        expect(result.positionAtZeroRate).toBeCloseTo(5);
        expect(result.zeroRateResumeOffset).toBeCloseTo(5);
    });

    test("does not complete buffered playback when channel pause stops its source", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const context = probe.context();
            const channel = k.createAudioChannel();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const playback = k.play(sound, { channel });
            const activeSource = context.bufferSources.at(-1);
            let endCount = 0;
            playback.onEnd(() => endCount++);

            context.currentTime = 2;
            channel.paused = true;
            probe.endBuffer(activeSource);
            const afterPause = {
                endCount,
                paused: playback.paused,
                time: playback.time(),
            };

            playback.paused = true;
            channel.paused = false;
            const afterChannelResume = playback.paused;
            context.currentTime = 3;
            playback.paused = false;
            context.currentTime = 4;

            return {
                afterChannelResume,
                afterPause,
                endCount,
                resumedTime: playback.time(),
            };
        });

        expect(result.afterPause.paused).toBe(true);
        expect(result.afterPause.time).toBeCloseTo(2);
        expect(result.afterPause.endCount).toBe(0);
        expect(result.afterChannelResume).toBe(true);
        expect(result.resumedTime).toBeCloseTo(3);
        expect(result.endCount).toBe(0);
    });

    test("does not restart completed buffered playback when channel state changes", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe;
            const context = probe.context();
            const channel = k.createAudioChannel();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const playback = k.play(sound, { channel });
            const completedSource = context.bufferSources.at(-1);
            let endCount = 0;
            playback.onEnd(() => endCount++);

            context.currentTime = 10;
            probe.endBuffer(completedSource);
            const startsAtCompletion = context.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            channel.paused = true;
            channel.paused = false;
            const startsAfterChannelResume = context.bufferSources.reduce(
                (total: number, source: any) => total + source.starts,
                0,
            );
            playback.play(2);
            const replaySource = context.bufferSources.at(-1);

            return {
                endCount,
                replayOffset: replaySource.startOffsets.at(-1),
                replayStarts: context.bufferSources.reduce(
                    (total: number, source: any) => total + source.starts,
                    0,
                ) - startsAfterChannelResume,
                startsAfterChannelResume,
                startsAtCompletion,
            };
        });

        expect(result).toEqual({
            endCount: 1,
            replayOffset: 2,
            replayStarts: 1,
            startsAfterChannelResume: 1,
            startsAtCompletion: 1,
        });
    });

    test("explicit reconnecting leaves selected channels for sounds and music", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const probe = (window as any).__audioProbe.context();
            const channel = k.createAudioChannel({ volume: 0.2 });
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            const playback = k.play(sound, {
                channel,
                volume: 0.5,
            });
            const source = probe.bufferSources.at(-1);
            playback.paused = true;
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");
            const music = k.play("track", {
                channel,
                paused: true,
                volume: 0.5,
            });
            const musicSource = probe.mediaSources.at(-1);
            const custom = k.audioCtx.createGain();
            custom.gain.value = 0.4;
            custom.connect(k.audioCtx.destination);

            k.setVolume(0.25);
            const throughChannel = probe.levelFrom(source);
            playback.connect(custom);
            const throughCustom = probe.levelFrom(source);
            const pausedThroughCustom = playback.paused;
            channel.volume = 0.8;
            const afterChannelUpdate = probe.levelFrom(source);
            playback.connect();
            const throughMaster = probe.levelFrom(source);
            const pausedThroughMaster = playback.paused;
            const musicThroughChannel = probe.levelFrom(musicSource);
            music.connect(custom);
            const musicThroughCustom = probe.levelFrom(musicSource);
            const musicPausedThroughCustom = music.paused;
            channel.volume = 0.4;
            const musicAfterChannelUpdate = probe.levelFrom(musicSource);
            music.connect();
            const musicThroughMaster = probe.levelFrom(musicSource);
            const musicPausedThroughMaster = music.paused;

            return {
                afterChannelUpdate,
                musicAfterChannelUpdate,
                musicPausedThroughCustom,
                musicPausedThroughMaster,
                musicThroughChannel,
                musicThroughCustom,
                musicThroughMaster,
                pausedThroughCustom,
                pausedThroughMaster,
                throughChannel,
                throughCustom,
                throughMaster,
            };
        });

        expect(result.throughChannel).toBeCloseTo(0.025);
        expect(result.throughCustom).toBeCloseTo(0.2);
        expect(result.afterChannelUpdate).toBeCloseTo(0.2);
        expect(result.throughMaster).toBeCloseTo(0.125);
        expect(result.musicThroughChannel).toBeCloseTo(0.1);
        expect(result.musicThroughCustom).toBeCloseTo(0.2);
        expect(result.musicAfterChannelUpdate).toBeCloseTo(0.2);
        expect(result.musicThroughMaster).toBeCloseTo(0.125);
        expect(result.pausedThroughCustom).toBe(true);
        expect(result.pausedThroughMaster).toBe(true);
        expect(result.musicPausedThroughCustom).toBe(true);
        expect(result.musicPausedThroughMaster).toBe(true);
    });

    test("rejects channel and connectTo together for sounds and music", async ({ page }) => {
        const result = await page.evaluate(() => {
            const k = kaplay({ global: false });
            const channel = k.createAudioChannel();
            const target = k.audioCtx.createGain();
            const sound = new k.SoundData(k.audioCtx.createBuffer(1, 80, 8));
            k.loadMusic("track", "data:audio/wav;base64,UklGRg==");

            let soundRejected = false;
            let musicRejected = false;
            try {
                k.play(sound, {
                    channel,
                    connectTo: target,
                    paused: true,
                });
            } catch {
                soundRejected = true;
            }
            try {
                k.play("track", {
                    channel,
                    connectTo: target,
                    paused: true,
                });
            } catch {
                musicRejected = true;
            }

            return { musicRejected, soundRejected };
        });

        expect(result.soundRejected).toBe(true);
        expect(result.musicRejected).toBe(true);
    });
});
