import { _k } from "../shared";

/**
 * Options for creating an audio channel.
 *
 * @group Audio
 */
export interface AudioChannelOpt {
    /**
     * Initial channel volume.
     */
    volume?: number;
    /**
     * Whether the channel starts muted.
     */
    muted?: boolean;
    /**
     * Whether playback through the channel starts paused.
     */
    paused?: boolean;
}

/**
 * A shared volume and mute control for audio playback.
 *
 * @group Audio
 */
export interface AudioChannel {
    /**
     * The channel volume.
     */
    volume: number;
    /**
     * Whether the channel is muted.
     */
    muted: boolean;
    /**
     * Whether playback through the channel is paused.
     */
    paused: boolean;
    /**
     * Stop all playback currently assigned to the channel.
     */
    stop(): void;
}

interface AudioChannelPlayback {
    setChannelPaused(paused: boolean): void;
    stopFromChannel(): void;
}

interface AudioChannelState {
    node: GainNode;
    volume: number;
    muted: boolean;
    paused: boolean;
    playbacks: Set<AudioChannelPlayback>;
}

const channelStates = new WeakMap<AudioChannel, AudioChannelState>();

function updateChannelGain(state: AudioChannelState) {
    state.node.gain.value = state.muted ? 0 : state.volume;
}

/**
 * Create a shared volume and mute control for audio playback.
 *
 * @group Audio
 */
export function createAudioChannel(
    opt: AudioChannelOpt = {},
): AudioChannel {
    const state: AudioChannelState = {
        node: _k.audio.ctx.createGain(),
        volume: Math.max(opt.volume ?? 1, 0),
        muted: opt.muted ?? false,
        paused: opt.paused ?? false,
        playbacks: new Set(),
    };

    const channel: AudioChannel = {
        get volume() {
            return state.volume;
        },
        set volume(value: number) {
            state.volume = Math.max(value, 0);
            updateChannelGain(state);
        },
        get muted() {
            return state.muted;
        },
        set muted(value: boolean) {
            state.muted = value;
            updateChannelGain(state);
        },
        get paused() {
            return state.paused;
        },
        set paused(value: boolean) {
            if (state.paused === value) return;
            state.paused = value;
            for (const playback of state.playbacks) {
                playback.setChannelPaused(value);
            }
        },
        stop() {
            for (const playback of state.playbacks) {
                playback.stopFromChannel();
            }
        },
    };

    state.node.connect(_k.audio.masterNode);
    updateChannelGain(state);
    channelStates.set(channel, state);

    return channel;
}

export function registerAudioChannelPlayback(
    channel: AudioChannel | undefined,
    playback: AudioChannelPlayback,
): () => void {
    if (!channel) return () => {};

    const state = channelStates.get(channel);
    if (!state) {
        throw new Error("Invalid audio channel");
    }

    state.playbacks.add(playback);
    playback.setChannelPaused(state.paused);
    return () => state.playbacks.delete(playback);
}

export function resolveAudioDestination(
    channel?: AudioChannel,
    connectTo?: AudioNode,
): AudioNode {
    if (channel && connectTo) {
        throw new Error("channel and connectTo cannot be used together");
    }

    if (!channel) return connectTo ?? _k.audio.masterNode;

    const state = channelStates.get(channel);
    if (!state) {
        throw new Error("Invalid audio channel");
    }

    return state.node;
}
