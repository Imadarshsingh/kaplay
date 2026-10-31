import type { AudioPlayOpt } from "../src/audio/play";
import type { KAPLAYCtx } from "../src/core/contextType";

declare const context: KAPLAYCtx;

const channel = context.createAudioChannel();
const configured = context.createAudioChannel({
    muted: true,
    paused: true,
    volume: 0.5,
});

channel.volume = configured.volume;
channel.muted = configured.muted;
channel.paused = configured.paused;
channel.stop();

const options: AudioPlayOpt = { channel };
void options;
