import { KEvent } from "../events/events";
import { clamp } from "../math/clamp";
import { _k } from "../shared";
import {
    registerAudioChannelPlayback,
    resolveAudioDestination,
} from "./channel";
import type { AudioPlay, AudioPlayOpt } from "./play";

export function playMusic(url: string, opt: AudioPlayOpt = {}): AudioPlay {
    const onEndEvents = new KEvent();
    const el = new Audio(url);
    let playPaused = opt.paused ?? false;
    let channelPaused = false;
    let paused = playPaused;
    let completed = false;
    el.crossOrigin = "anonymous";
    el.loop = Boolean(opt.loop);
    el.volume = opt.volume ?? 1;
    el.playbackRate = opt.speed ?? 1;
    if (opt.seek !== undefined) {
        el.currentTime = opt.seek;
    }

    const src = _k.audio.ctx.createMediaElementSource(el);

    src.connect(resolveAudioDestination(opt.channel, opt.connectTo));

    function resumeAudioCtx() {
        if (_k.debug.paused) return;
        if (_k.app.isHidden() && !_k.globalOpt.backgroundAudio) return;
        _k.audio.ctx.resume();
    }

    function playElement() {
        resumeAudioCtx();
        el.play();
    }

    function syncPaused() {
        const nextPaused = playPaused || channelPaused;
        if (paused === nextPaused) return;

        paused = nextPaused;
        if (paused) {
            el.pause();
        }
        else {
            playElement();
        }
    }

    el.onended = () => {
        completed = true;
        playPaused = true;
        paused = true;
        onEndEvents.trigger();
    };

    const playback: AudioPlay = {
        play(time?: number) {
            if (time !== undefined) {
                el.currentTime = time;
            }
            else if (completed) {
                el.currentTime = 0;
            }
            completed = false;
            playPaused = false;
            if (paused) {
                syncPaused();
            }
            else {
                playElement();
            }
        },

        seek(time: number) {
            el.currentTime = time;
        },

        stop() {
            completed = false;
            playPaused = true;
            syncPaused();
            this.seek(0);
        },

        set loop(l: boolean) {
            el.loop = l;
        },

        get loop() {
            return el.loop;
        },

        set paused(p: boolean) {
            playPaused = p;
            syncPaused();
        },

        get paused() {
            return paused;
        },

        time() {
            return el.currentTime;
        },

        duration() {
            return el.duration;
        },

        set volume(val: number) {
            el.volume = clamp(val, 0, 1);
        },

        get volume() {
            return el.volume;
        },

        set speed(s) {
            el.playbackRate = Math.max(s, 0);
        },

        get speed() {
            return el.playbackRate;
        },

        set detune(d) {
            throw new Error(
                "Music cannot be detuned (limitation of the browser APIs, womp womp)",
            );
        },

        get detune() {
            return 0;
        },

        onEnd(action: () => void) {
            return onEndEvents.add(action);
        },

        then(action: () => void) {
            return this.onEnd(action);
        },

        connect(node?: AudioNode) {
            src.disconnect();
            src.connect(node ?? _k.audio.masterNode);
            detachChannel();
            detachChannel = () => {};
            channelPaused = false;
            syncPaused();
        },
    };

    let detachChannel = registerAudioChannelPlayback(opt.channel, {
        setChannelPaused(value) {
            channelPaused = value;
            syncPaused();
        },
        stopFromChannel() {
            playback.stop();
        },
    });

    if (!paused) {
        playElement();
    }

    return playback;
}
