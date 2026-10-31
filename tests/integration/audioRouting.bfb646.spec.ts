import { expect, type Page, test } from "@playwright/test";

async function installRoutingProbe(page: Page) {
    await page.addScriptTag({ path: "dist/kaplay.js" });
    await page.evaluate(() => {
        class ProbeParam {
            constructor(public value: number) {}
        }

        class ProbeNode {
            outputs: ProbeNode[] = [];

            connect(node: ProbeNode) {
                this.outputs.push(node);
                return node;
            }

            disconnect() {
                this.outputs = [];
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

            start() {}
            stop() {}
        }

        class ProbeAudioContext {
            static instances: ProbeAudioContext[] = [];
            currentTime = 0;
            destination = new ProbeNode();
            bufferSources: ProbeBufferSourceNode[] = [];

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
                const visit = (node: ProbeNode, level: number): number => {
                    if (node instanceof ProbeGainNode) {
                        level *= node.gain.value;
                    }
                    if (node === this.destination) return level;
                    return node.outputs.reduce(
                        (sum, output) => sum + visit(output, level),
                        0,
                    );
                };
                return visit(source, 1);
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
        (window as any).__routingProbe = ProbeAudioContext;
    });
}

test("buffered connectTo bypasses the master output", async ({ page }) => {
    await installRoutingProbe(page);
    const result = await page.evaluate(() => {
        const k = kaplay({ global: false });
        const ProbeAudioContext = (window as any).__routingProbe;
        const probe = ProbeAudioContext.instances.at(-1);
        k.setVolume(0.25);
        const channel = k.createAudioChannel({ volume: 0.25 });
        const custom = k.audioCtx.createGain();
        custom.gain.value = 0.4;
        custom.connect(k.audioCtx.destination);
        const sound = new k.SoundData(
            k.audioCtx.createBuffer(1, 80, 8),
        );

        k.play(sound, { channel, volume: 0.5 });
        const throughChannel = probe.levelFrom(
            probe.bufferSources.at(-1),
        );
        k.play(sound, { connectTo: custom, volume: 0.5 });
        const throughCustom = probe.levelFrom(
            probe.bufferSources.at(-1),
        );

        return { throughChannel, throughCustom };
    });

    expect(result.throughChannel).toBeCloseTo(0.03125);
    expect(result.throughCustom).toBeCloseTo(0.2);
});
