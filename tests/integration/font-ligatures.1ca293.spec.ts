import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: resolve("dist/kaplay.js") });
});

test("public declarations accept ligature labels", () => {
    const result = spawnSync(
        process.execPath,
        [
            resolve("node_modules/typescript/bin/tsc"),
            "--project",
            resolve("tests/tsconfig.font-ligature-api.json"),
        ],
        { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(
        [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).toBe("");
    expect(result.status).toBe(0);
});

test("canonically single-grapheme array labels stay ordinary", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 160,
            height: 100,
        });
        const loaded = (asset: any) =>
            new Promise<any>((accept, reject) => {
                asset.onLoad(accept);
                asset.onError(reject);
            });
        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"10\"><rect width=\"10\" height=\"10\" fill=\"#ff0000\"/><rect x=\"10\" width=\"10\" height=\"10\" fill=\"#00ff00\"/><rect x=\"20\" width=\"10\" height=\"10\" fill=\"#0000ff\"/><rect x=\"30\" width=\"10\" height=\"10\" fill=\"#ffff00\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;

        const modernFont = await loaded(k.loadBitmapFont(
            null,
            src,
            10,
            10,
            { chars: ["e\u0301"] },
        ));
        const modernCalls: unknown[] = [];
        const modern = k.formatText({
            text: "e\u0301",
            font: modernFont,
            transform: (index: number, ch: string) => {
                modernCalls.push([index, ch]);
                return {};
            },
        });

        const segmenter = Intl.Segmenter;
        let legacyFont: any;
        let legacy: any;
        const legacyCalls: unknown[] = [];
        try {
            (Intl as any).Segmenter = undefined;
            legacyFont = await loaded(k.loadBitmapFont(
                null,
                src,
                10,
                10,
                { chars: ["a", "\u0315", "\u0300", "a\u0300\u0315"] },
            ));
            legacy = k.formatText({
                text: "a\u0315\u0300",
                font: legacyFont,
                transform: (index: number, ch: string) => {
                    legacyCalls.push([index, ch]);
                    return {};
                },
            });
        } finally {
            (Intl as any).Segmenter = segmenter;
        }

        const output = {
            modern: modern.chars.map((ch: any) => [
                ch.ch,
                ch.textCursor,
                ch.frame === modernFont.map["e\u0301"],
            ]),
            modernCalls,
            modernRendered: modern.renderedText,
            legacy: legacy.chars.map((ch: any) => [
                ch.ch,
                ch.textCursor,
                ch.frame === legacyFont.map[ch.ch],
            ]),
            legacyCalls,
            legacyRendered: legacy.renderedText,
        };
        k.quit();
        return output;
    });

    expect(result).toEqual({
        modern: [["\u00e9", 0, true]],
        modernCalls: [[0, "\u00e9"]],
        modernRendered: "e\u0301",
        legacy: [
            ["a", 0, true],
            ["\u0315", 1, true],
            ["\u0300", 2, true],
        ],
        legacyCalls: [[0, "a"], [1, "\u0315"], [2, "\u0300"]],
        legacyRendered: "a\u0315\u0300",
    });
});

test("font loaders snapshot label arrays when invoked", async ({ page }) => {
    const fontUrl = `data:font/ttf;base64,${
        readFileSync(resolve("examples/fonts/Anton-Regular.ttf")).toString(
            "base64",
        )
    }`;
    const result = await page.evaluate(async ({ fontUrl }) => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 240,
            height: 120,
        });
        const loaded = (asset: any) =>
            new Promise<any>((accept, reject) => {
                asset.onLoad(accept);
                asset.onError(reject);
            });
        const chars = (font: any, text: string) =>
            k.formatText({ text, font }).chars.map((ch: any) => ch.ch);

        const outlineLabels = ["fi"];
        const firstOutlineAsset = k.loadFont(
            "snapshot-outline-first",
            fontUrl,
            { ligatures: outlineLabels },
        );
        outlineLabels[0] = "fl";
        const secondOutlineAsset = k.loadFont(
            "snapshot-outline-second",
            fontUrl,
            { ligatures: outlineLabels },
        );
        outlineLabels[0] = "ff";

        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"10\"><rect width=\"40\" height=\"10\" fill=\"white\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const gridLabels = ["fi", "f", "i", "l"];
        const firstGridAsset = k.loadBitmapFont(
            "snapshot-grid-first",
            src,
            10,
            10,
            { chars: gridLabels },
        );
        gridLabels[0] = "fl";
        const secondGridAsset = k.loadBitmapFont(
            "snapshot-grid-second",
            src,
            10,
            10,
            { chars: gridLabels },
        );
        gridLabels[0] = "ff";

        const spriteAsset = k.loadSprite("snapshot-sprite", src, {
            sliceX: 4,
        });
        const spriteLabels = ["fi", "f", "i", "l"];
        const firstSpriteFontAsset = k.loadBitmapFontFromSprite(
            "snapshot-sprite",
            spriteLabels,
        );
        spriteLabels[0] = "fl";
        const secondSpriteFontAsset = k.loadBitmapFontFromSprite(
            "snapshot-sprite",
            spriteLabels,
        );
        spriteLabels[0] = "ff";

        const [
            firstOutline,
            secondOutline,
            firstGrid,
            secondGrid,
            _sprite,
            firstSpriteFont,
            secondSpriteFont,
        ] = await Promise.all([
            loaded(firstOutlineAsset),
            loaded(secondOutlineAsset),
            loaded(firstGridAsset),
            loaded(secondGridAsset),
            loaded(spriteAsset),
            loaded(firstSpriteFontAsset),
            loaded(secondSpriteFontAsset),
        ]);

        outlineLabels[0] = "ffi";
        gridLabels[0] = "ffi";
        spriteLabels[0] = "ffi";

        const output = {
            outline: {
                firstFi: chars(firstOutline, "fi"),
                firstFl: chars(firstOutline, "fl"),
                secondFi: chars(secondOutline, "fi"),
                secondFl: chars(secondOutline, "fl"),
            },
            grid: {
                firstFi: chars(firstGrid, "fi"),
                firstFl: chars(firstGrid, "fl"),
                secondFi: chars(secondGrid, "fi"),
                secondFl: chars(secondGrid, "fl"),
            },
            sprite: {
                firstFi: chars(firstSpriteFont, "fi"),
                firstFl: chars(firstSpriteFont, "fl"),
                secondFi: chars(secondSpriteFont, "fi"),
                secondFl: chars(secondSpriteFont, "fl"),
            },
        };
        k.quit();
        return output;
    }, { fontUrl });

    expect(result).toEqual({
        outline: {
            firstFi: ["fi"],
            firstFl: ["f", "l"],
            secondFi: ["f", "i"],
            secondFl: ["fl"],
        },
        grid: {
            firstFi: ["fi"],
            firstFl: ["f", "l"],
            secondFi: ["f", "i"],
            secondFl: ["fl"],
        },
        sprite: {
            firstFi: ["fi"],
            firstFl: ["f", "l"],
            secondFi: ["f", "i"],
            secondFl: ["fl"],
        },
    });
});

test("font overrides preserve canonical ligature identity", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 200,
            height: 120,
        });
        const loaded = (asset: any) =>
            new Promise<any>((accept, reject) => {
                asset.onLoad(accept);
                asset.onError(reject);
            });
        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"30\" height=\"10\"><rect width=\"10\" height=\"10\" fill=\"#ff0000\"/><rect x=\"10\" width=\"10\" height=\"10\" fill=\"#00ff00\"/><rect x=\"20\" width=\"10\" height=\"10\" fill=\"#0000ff\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const sourceFont = await loaded(k.loadBitmapFont(
            "canonical-source",
            src,
            10,
            10,
            { chars: ["\u00e9x", "\u00e9", "x"] },
        ));
        const gridFont = await loaded(k.loadBitmapFont(
            "canonical-grid-target",
            src,
            10,
            10,
            { chars: ["e\u0301x", "\u00e9", "x"] },
        ));
        const sprite = k.loadSprite("canonical-sprite-target", src, {
            sliceX: 3,
        });
        const spriteFontAsset = k.loadBitmapFontFromSprite(
            "canonical-sprite-target",
            ["e\u0301x", "\u00e9", "x"],
        );
        const [, spriteFont] = await Promise.all([
            loaded(sprite),
            loaded(spriteFontAsset),
        ]);

        const transformCalls: unknown[] = [];
        const transformed = k.formatText({
            text: "e\u0301x",
            font: sourceFont,
            transform: (idx: number, ch: string) => {
                transformCalls.push([idx, ch]);
                return { font: "canonical-grid-target" };
            },
        });
        const styleCalls: unknown[] = [];
        const styled = k.formatText({
            text: "[swap]e\u0301x[/swap]",
            font: sourceFont,
            styles: {
                swap: (idx: number, ch: string) => {
                    styleCalls.push([idx, ch]);
                    return { font: "canonical-sprite-target" };
                },
            },
        });
        const output = {
            transformed: transformed.chars.map((ch: any) => ({
                ch: ch.ch,
                cursor: ch.textCursor,
                targetFrame: ch.frame === gridFont.map["e\u0301x"],
            })),
            transformedText: transformed.renderedText,
            styled: styled.chars.map((ch: any) => ({
                ch: ch.ch,
                cursor: ch.textCursor,
                targetFrame: ch.frame === spriteFont.map["e\u0301x"],
            })),
            styledText: styled.renderedText,
            transformCalls,
            styleCalls,
        };
        k.quit();
        return output;
    });

    expect(result).toEqual({
        transformed: [{ ch: "\u00e9x", cursor: 0, targetFrame: true }],
        transformedText: "e\u0301x",
        styled: [{ ch: "\u00e9x", cursor: 0, targetFrame: true }],
        styledText: "e\u0301x",
        transformCalls: [[0, "\u00e9x"]],
        styleCalls: [[0, "\u00e9x"]],
    });
});

test("bitmap grid labels choose the longest match and remain atomic", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 240,
            height: 120,
        });
        const labels = [
            "f",
            "i",
            "ff",
            "fi",
            "ffi",
            "x",
            "q",
            " ",
            "abcd",
            "😀",
        ];
        const colors = [
            "#ff0000",
            "#00ff00",
            "#0000ff",
            "#ffff00",
            "#ff00ff",
            "#00ffff",
            "#000000",
            "#ffffff",
            "#ff8000",
            "#ffffff",
        ];
        const cells = colors.map((color, index) =>
            `<rect x="${index * 10}" width="10" height="10" fill="${color}"/>`
        ).join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${
            labels.length * 10
        }" height="10">${cells}</svg>`;
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const asset = k.loadBitmapFont(null, src, 10, 10, { chars: labels });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const seen: unknown[] = [];
        const formatted = k.formatText({
            text: "x ffix fiq",
            font,
            size: 10,
            letterSpacing: 2,
            transform: (idx: number, ch: string) => {
                seen.push([idx, ch]);
                return { color: k.RED, opacity: 0.5 };
            },
        });
        const fallback = k.formatText({ text: "fx", font });
        const longLabel = k.formatText({ text: "abcd", font });
        const ordinaryGrapheme = k.formatText({
            text: "😀",
            font,
            transform: () => ({ color: k.RED }),
        });
        const sampleFrame = (frame: any) => {
            const source = frame.tex.src as HTMLCanvasElement;
            const context = source.getContext("2d")!;
            const x = Math.floor((frame.q.x + frame.q.w / 2) * frame.tex.width);
            const y = Math.floor(
                (frame.q.y + frame.q.h / 2) * frame.tex.height,
            );
            return Array.from(context.getImageData(x, y, 1, 1).data);
        };
        const topologySvg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\"><rect width=\"10\" height=\"10\" fill=\"#ff0000\"/><rect x=\"10\" width=\"10\" height=\"10\" fill=\"#00ff00\"/><rect y=\"10\" width=\"10\" height=\"10\" fill=\"#0000ff\"/><rect x=\"10\" y=\"10\" width=\"10\" height=\"10\" fill=\"#ffff00\"/></svg>";
        const topologySrc = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(topologySvg)
        }`;
        const topologyAsset = k.loadBitmapFont(
            "topology-font",
            topologySrc,
            10,
            10,
            { chars: ["abc", "ab", "a", "x"] },
        );
        const topologyFont = await new Promise((accept, reject) => {
            topologyAsset.onLoad(accept);
            topologyAsset.onError(reject);
        });
        const topology = k.formatText({ text: "abcax", font: topologyFont });
        const named = k.formatText({ text: "abc", font: "topology-font" });
        const output = {
            renderedText: formatted.renderedText,
            width: formatted.width,
            chars: formatted.chars.map((ch: any) => ({
                ch: ch.ch,
                cursor: ch.textCursor,
                width: ch.width,
                assignedFrame: ch.frame === (font as any).map[ch.ch],
            })),
            transformColors: formatted.chars.map((ch: any) => [
                ch.color.r,
                ch.color.g,
                ch.color.b,
            ]),
            transformOpacities: formatted.chars.map((ch: any) => ch.opacity),
            fallback: fallback.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            longLabel: longLabel.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            ordinaryGrapheme: ordinaryGrapheme.chars.map((ch: any) => ({
                ch: ch.ch,
                color: [ch.color.r, ch.color.g, ch.color.b],
            })),
            framePixels: labels.map(label =>
                sampleFrame((font as any).map[label])
            ),
            topology: topology.chars.map((ch: any) => ({
                ch: ch.ch,
                cursor: ch.textCursor,
                framePixel: sampleFrame(ch.frame),
            })),
            named: named.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            seen,
        };
        k.quit();
        return output;
    });

    expect(result.renderedText).toBe("x ffix fiq");
    expect(result.width).toBe(82);
    expect(result.transformColors).toEqual(
        Array.from({ length: 7 }, () => [255, 0, 0]),
    );
    expect(result.transformOpacities).toEqual([
        0.5,
        0.5,
        0.5,
        0.5,
        0.5,
        0.5,
        0.5,
    ]);
    expect(result.fallback).toEqual([["f", 0], ["x", 1]]);
    expect(result.longLabel).toEqual([["abcd", 0]]);
    expect(result.framePixels).toEqual([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
        [255, 0, 255, 255],
        [0, 255, 255, 255],
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [255, 128, 0, 255],
        [255, 255, 255, 255],
    ]);
    expect(result.ordinaryGrapheme).toEqual([{
        ch: "😀",
        color: [255, 255, 255],
    }]);
    expect(result.topology).toEqual([
        { ch: "abc", cursor: 0, framePixel: [255, 0, 0, 255] },
        { ch: "a", cursor: 3, framePixel: [0, 0, 255, 255] },
        { ch: "x", cursor: 4, framePixel: [255, 255, 0, 255] },
    ]);
    expect(result.named).toEqual([["abc", 0]]);
    expect(result.chars).toEqual([
        { ch: "x", cursor: 0, width: 10, assignedFrame: true },
        { ch: " ", cursor: 1, width: 10, assignedFrame: true },
        { ch: "ffi", cursor: 2, width: 10, assignedFrame: true },
        { ch: "x", cursor: 5, width: 10, assignedFrame: true },
        { ch: " ", cursor: 6, width: 10, assignedFrame: true },
        { ch: "fi", cursor: 7, width: 10, assignedFrame: true },
        { ch: "q", cursor: 9, width: 10, assignedFrame: true },
    ]);
    expect(result.seen).toEqual([
        [0, "x"],
        [1, " "],
        [2, "ffi"],
        [5, "x"],
        [6, " "],
        [7, "fi"],
        [9, "q"],
    ]);
});

test("styled runs and newlines bound matching", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 200,
            height: 120,
        });
        const labels = [
            "é",
            "f",
            "i",
            "fi",
            "f\ni",
            "x",
            "éx",
            "a",
            "a\u00e9",
            "a\u0300\u0315b",
        ];
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="10"><rect width="100" height="10" fill="white"/></svg>`;
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const asset = k.loadBitmapFont(null, src, 10, 10, { chars: labels });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const legacyAsset = k.loadBitmapFont(null, src, 10, 10, {
            chars: ["e\u0308"],
        });
        const legacyFont = await new Promise((accept, reject) => {
            legacyAsset.onLoad(accept);
            legacyAsset.onError(reject);
        });
        const styleCalls: unknown[] = [];
        const sameRun = k.formatText({
            text: "[hot]fi[/hot]",
            font,
            styles: {
                hot: (idx: number, ch: string) => {
                    styleCalls.push([idx, ch]);
                    return { color: k.GREEN, opacity: 0.5 };
                },
            },
        });
        const splitRun = k.formatText({
            text: "f[hot]i[/hot]",
            font,
            styles: { hot: { opacity: 0.5 } },
        });
        const paramCalls: unknown[] = [];
        const splitParam = k.formatText({
            text: "[hot=left]f[/hot][hot=right]i[/hot]",
            font,
            styles: {
                hot: (idx: number, ch: string, param: string) => {
                    paramCalls.push([idx, ch, param]);
                    return {};
                },
            },
        });
        const splitSameStyle = k.formatText({
            text: "[hot]f[/hot][hot]i[/hot]",
            font,
            styles: { hot: { opacity: 0.5 } },
        });
        const splitNested = k.formatText({
            text: "[outer]f[inner]i[/inner][/outer]",
            font,
            styles: { outer: {}, inner: {} },
        });
        const splitAfterDecomposed = k.formatText({
            text: "[hot]e\u0301f[/hot]i",
            font,
            styles: { hot: {} },
        });
        const splitInsideGrapheme = k.formatText({
            text: "ae[hot]\u0301[/hot]",
            font,
            styles: { hot: {} },
        });
        const canonicalCalls: unknown[] = [];
        const canonical = k.formatText({
            text: "e\u0301x",
            font,
            transform: (idx: number, ch: string) => {
                canonicalCalls.push([idx, ch]);
                return {};
            },
        });
        const segmenter = Intl.Segmenter;
        let legacyCanonical;
        let legacyReordered;
        let legacyUnmatched;
        try {
            (Intl as any).Segmenter = undefined;
            legacyCanonical = k.formatText({ text: "e\u0301x", font });
            legacyReordered = k.formatText({
                text: "a\u0315\u0300b",
                font,
            });
            legacyUnmatched = k.formatText({
                text: "e\u0308",
                font: legacyFont,
            });
        } finally {
            (Intl as any).Segmenter = segmenter;
        }
        const splitLine = k.formatText({ text: "f\ni", font });
        const output = {
            sameRun: sameRun.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            sameRunColor: [
                sameRun.chars[0].color.r,
                sameRun.chars[0].color.g,
                sameRun.chars[0].color.b,
            ],
            sameRunOpacity: sameRun.chars.map((ch: any) => ch.opacity),
            splitRun: splitRun.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            splitParam: splitParam.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitSameStyle: splitSameStyle.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitNested: splitNested.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitAfterDecomposed: splitAfterDecomposed.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitAfterDecomposedRendered: splitAfterDecomposed.renderedText,
            splitInsideGrapheme: splitInsideGrapheme.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitInsideGraphemeRendered: splitInsideGrapheme.renderedText,
            canonical: canonical.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            canonicalRendered: canonical.renderedText,
            legacyCanonical: legacyCanonical.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            legacyCanonicalRendered: legacyCanonical.renderedText,
            legacyReordered: legacyReordered.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            legacyReorderedRendered: legacyReordered.renderedText,
            legacyUnmatched: legacyUnmatched.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor]),
            splitLine: splitLine.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor, ch.pos.y]),
            sameRendered: sameRun.renderedText,
            splitRendered: splitRun.renderedText,
            styleCalls,
            paramCalls,
            canonicalCalls,
        };
        k.quit();
        return output;
    });

    expect(result.sameRun).toEqual([["fi", 0]]);
    expect(result.sameRunColor).toEqual([0, 255, 0]);
    expect(result.sameRunOpacity).toEqual([0.5]);
    expect(result.splitRun).toEqual([["f", 0], ["i", 1]]);
    expect(result.splitParam).toEqual([["f", 0], ["i", 1]]);
    expect(result.splitSameStyle).toEqual([["f", 0], ["i", 1]]);
    expect(result.splitNested).toEqual([["f", 0], ["i", 1]]);
    expect(result.splitAfterDecomposed).toEqual([
        ["é", 0],
        ["f", 1],
        ["i", 2],
    ]);
    expect(result.splitAfterDecomposedRendered).toBe("e\u0301fi");
    expect(result.splitInsideGrapheme).toEqual([
        ["a", 0],
        ["\u00e9", 1],
    ]);
    expect(result.splitInsideGraphemeRendered).toBe("ae\u0301");
    expect(result.canonical).toEqual([["éx", 0]]);
    expect(result.canonicalRendered).toBe("e\u0301x");
    expect(result.canonicalCalls).toEqual([[0, "éx"]]);
    expect(result.legacyCanonical).toEqual([["éx", 0]]);
    expect(result.legacyCanonicalRendered).toBe("e\u0301x");
    expect(result.legacyReordered).toEqual([["a\u0300\u0315b", 0]]);
    expect(result.legacyReorderedRendered).toBe("a\u0315\u0300b");
    expect(result.legacyUnmatched).toEqual([["e\u0308", 0]]);
    expect(result.paramCalls).toEqual([[0, "f", "left"], [1, "i", "right"]]);
    expect(result.splitLine.map(ch => ch.slice(0, 2))).toEqual([
        ["f", 0],
        ["i", 2],
    ]);
    expect(result.splitLine[1][2]).toBeGreaterThan(
        result.splitLine[0][2] as number,
    );
    expect(result.sameRendered).toBe("fi");
    expect(result.splitRendered).toBe("fi");
    expect(result.styleCalls).toEqual([[0, "fi"]]);
});

test("wrapping and letter spacing count a ligature once", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 200,
            height: 120,
        });
        const labels = ["a", " ", "f", "i", "fi", "q"];
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="10"><rect width="60" height="10" fill="white"/></svg>`;
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const asset = k.loadBitmapFont(null, src, 10, 10, { chars: labels });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const wrapped = k.formatText({ text: "a fiq", font, width: 35 });
        const spaced = k.formatText({ text: "fifi", font, letterSpacing: 2 });
        const aligned = k.formatText({
            text: "fi",
            font,
            width: 30,
            align: "right",
        });
        const transformed = k.formatText({
            text: "fiq",
            font,
            transform: (_idx: number, ch: string) =>
                ch === "fi"
                    ? { scale: 2, stretchInPlace: false }
                    : {},
        });
        const styled = k.formatText({
            text: "[wide]fi[/wide]q",
            font,
            styles: {
                wide: { scale: 2, stretchInPlace: false },
            },
        });
        const output = {
            wrapped: wrapped.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor, ch.pos.y]),
            spacedChars: spaced.chars.map((
                ch: any,
            ) => [ch.ch, ch.textCursor, ch.pos.x]),
            spacedWidth: spaced.width,
            aligned: aligned.chars.map((ch: any) => [ch.ch, ch.pos.x]),
            transformed: {
                width: transformed.width,
                chars: transformed.chars.map((ch: any) => [ch.ch, ch.pos.x]),
            },
            styled: {
                width: styled.width,
                chars: styled.chars.map((ch: any) => [ch.ch, ch.pos.x]),
            },
        };
        k.quit();
        return output;
    });

    expect(result.wrapped.map(ch => ch.slice(0, 2))).toEqual([
        ["a", 0],
        ["fi", 2],
        ["q", 4],
    ]);
    expect(result.wrapped[1][2]).toBeGreaterThan(
        result.wrapped[0][2] as number,
    );
    expect(result.wrapped[2][2]).toBe(result.wrapped[1][2]);
    expect(result.spacedChars).toEqual([
        ["fi", 0, 5],
        ["fi", 2, 17],
    ]);
    expect(result.spacedWidth).toBe(22);
    expect(result.aligned).toEqual([["fi", 25]]);
    expect(result.transformed).toEqual({
        width: 30,
        chars: [["fi", 10], ["q", 25]],
    });
    expect(result.styled).toEqual({
        width: 30,
        chars: [["fi", 10], ["q", 25]],
    });
});

test("sprite font arrays map labels to their corresponding frames", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 200,
            height: 100,
        });
        const labels = ["a", "--", "-->", "b", "ab", "a b"];
        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"60\" height=\"10\"><rect width=\"10\" height=\"10\" fill=\"#ff0000\"/><rect x=\"10\" width=\"10\" height=\"10\" fill=\"#00ff00\"/><rect x=\"20\" width=\"10\" height=\"10\" fill=\"#0000ff\"/><rect x=\"30\" width=\"10\" height=\"10\" fill=\"#ffff00\"/><rect x=\"40\" width=\"10\" height=\"10\" fill=\"#ff00ff\"/><rect x=\"50\" width=\"10\" height=\"10\" fill=\"#00ffff\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const sprite = k.loadSprite("route-font", src, { sliceX: 6 });
        const asset = k.loadBitmapFontFromSprite("route-font", labels);
        await new Promise((accept, reject) => {
            sprite.onLoad(accept);
            sprite.onError(reject);
        });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const formatted = k.formatText({ text: "a-->b--a b", font });
        const sampleFrame = (frame: any) => {
            const source = frame.tex.src as HTMLCanvasElement;
            const context = source.getContext("2d")!;
            const x = Math.floor((frame.q.x + frame.q.w / 2) * frame.tex.width);
            const y = Math.floor(
                (frame.q.y + frame.q.h / 2) * frame.tex.height,
            );
            return Array.from(context.getImageData(x, y, 1, 1).data);
        };
        const arrayOutput = formatted.chars.map((ch: any) => ({
            ch: ch.ch,
            cursor: ch.textCursor,
            framePixel: sampleFrame(ch.frame),
        }));
        const legacySprite = k.loadSprite("legacy-route-font", src, {
            sliceX: 6,
        });
        await new Promise((accept, reject) => {
            legacySprite.onLoad(accept);
            legacySprite.onError(reject);
        });
        const legacyAsset = k.loadBitmapFontFromSprite(
            "legacy-route-font",
            "ab",
        );
        const legacyFont = await new Promise((accept, reject) => {
            legacyAsset.onLoad(accept);
            legacyAsset.onError(reject);
        });
        const legacyOutput = k.formatText({ text: "ab", font: legacyFont })
            .chars.map((ch: any) => [ch.ch, ch.textCursor]);
        k.quit();
        return { arrayOutput, legacyOutput };
    });

    expect(result.arrayOutput).toEqual([
        { ch: "a", cursor: 0, framePixel: [255, 0, 0, 255] },
        { ch: "-->", cursor: 1, framePixel: [0, 0, 255, 255] },
        { ch: "b", cursor: 4, framePixel: [255, 255, 0, 255] },
        { ch: "--", cursor: 5, framePixel: [0, 255, 0, 255] },
        { ch: "a b", cursor: 7, framePixel: [0, 255, 255, 255] },
    ]);
    expect(result.legacyOutput).toEqual([["a", 0], ["b", 1]]);
});

test("outline fonts rasterize declared overlapping labels", async ({ page }) => {
    const fontUrl = `data:font/ttf;base64,${
        readFileSync(resolve("examples/fonts/Anton-Regular.ttf")).toString(
            "base64",
        )
    }`;
    const result = await page.evaluate(async ({ fontUrl }) => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 240,
            height: 100,
        });
        const asset = k.loadFont("declared-outline", fontUrl, {
            ligatures: ["ff", "fi", "ffi"],
        });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const seen: unknown[] = [];
        const formatted = k.formatText({
            text: "office fi",
            font,
            transform: (idx: number, ch: string) => {
                seen.push([idx, ch]);
                return {};
            },
        });
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = `${(font as any).size}px ${
            (font as any).fontface.family
        }, sans-serif`;
        const measuredTogether = Math.ceil(context.measureText("ffi").width);
        const plainAsset = k.loadFont("plain-outline", fontUrl);
        const plainFont = await new Promise((accept, reject) => {
            plainAsset.onLoad(accept);
            plainAsset.onError(reject);
        });
        const plain = k.formatText({ text: "fi", font: plainFont });
        const declaredFirstAsset = k.loadFont(
            "shared-outline-declared-first",
            fontUrl,
            { ligatures: ["fi"] },
        );
        const declaredFirst = await new Promise((accept, reject) => {
            declaredFirstAsset.onLoad(accept);
            declaredFirstAsset.onError(reject);
        });
        const declaredFirstText = k.formatText({
            text: "fi",
            font: declaredFirst,
        });
        const plainAfterAsset = k.loadFont(
            "shared-outline-declared-first",
            fontUrl,
        );
        const plainAfter = await new Promise((accept, reject) => {
            plainAfterAsset.onLoad(accept);
            plainAfterAsset.onError(reject);
        });
        const plainAfterText = k.formatText({ text: "fi", font: plainAfter });
        const plainFirstAsset = k.loadFont(
            "shared-outline-plain-first",
            fontUrl,
        );
        const plainFirst = await new Promise((accept, reject) => {
            plainFirstAsset.onLoad(accept);
            plainFirstAsset.onError(reject);
        });
        const plainFirstText = k.formatText({ text: "fi", font: plainFirst });
        const declaredAfterAsset = k.loadFont(
            "shared-outline-plain-first",
            fontUrl,
            { ligatures: ["fi"] },
        );
        const declaredAfter = await new Promise((accept, reject) => {
            declaredAfterAsset.onLoad(accept);
            declaredAfterAsset.onError(reject);
        });
        const declaredAfterText = k.formatText({
            text: "fi",
            font: declaredAfter,
        });
        const ffiFrame = formatted.chars[1].frame;
        const atlasSource = ffiFrame.tex.src as HTMLCanvasElement;
        const atlasContext = atlasSource.getContext("2d")!;
        const frameX = Math.round(ffiFrame.q.x * ffiFrame.tex.width);
        const frameY = Math.round(ffiFrame.q.y * ffiFrame.tex.height);
        const frameWidth = Math.round(ffiFrame.q.w * ffiFrame.tex.width);
        const frameHeight = Math.round(ffiFrame.q.h * ffiFrame.tex.height);
        const pixels = atlasContext.getImageData(
            frameX,
            frameY,
            frameWidth,
            frameHeight,
        ).data;
        const frameHasInk = pixels.some((value, index) =>
            index % 4 === 3 && value > 0
        );
        const output = {
            renderedText: formatted.renderedText,
            chars: formatted.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            positiveWidths: formatted.chars.every((ch: any) => ch.width > 0),
            ffiWidth: formatted.chars[1].width,
            measuredTogether,
            plainChars: plain.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            sharedFamilies: {
                declaredFirst: declaredFirstText.chars.map((ch: any) => ch.ch),
                plainAfter: plainAfterText.chars.map((ch: any) => ch.ch),
                plainFirst: plainFirstText.chars.map((ch: any) => ch.ch),
                declaredAfter: declaredAfterText.chars.map((ch: any) => ch.ch),
            },
            frameHasInk,
            seen,
        };
        k.quit();
        return output;
    }, { fontUrl });

    expect(result).toMatchObject({
        renderedText: "office fi",
        chars: [["o", 0], ["ffi", 1], ["c", 4], ["e", 5], [" ", 6], ["fi", 7]],
        positiveWidths: true,
        seen: [[0, "o"], [1, "ffi"], [4, "c"], [5, "e"], [6, " "], [7, "fi"]],
    });
    expect(result.ffiWidth).toBe(result.measuredTogether);
    expect(result.plainChars).toEqual([["f", 0], ["i", 1]]);
    expect(result.sharedFamilies).toEqual({
        declaredFirst: ["fi"],
        plainAfter: ["f", "i"],
        plainFirst: ["f", "i"],
        declaredAfter: ["fi"],
    });
    expect(result.frameHasInk).toBe(true);
});

test("matching and cursors count grapheme clusters", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 200,
            height: 100,
        });
        const family = "👨‍👩‍👧‍👦";
        const labels = [family, `${family}a`, "a", "b"];
        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"10\"><rect width=\"40\" height=\"10\" fill=\"white\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const asset = k.loadBitmapFont(null, src, 10, 10, { chars: labels });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const seen: unknown[] = [];
        const formatted = k.formatText({
            text: `${family}ab`,
            font,
            transform: (idx: number, ch: string) => {
                seen.push([idx, ch]);
                return {};
            },
        });
        const output = {
            chars: formatted.chars.map((ch: any) => [ch.ch, ch.textCursor]),
            seen,
        };
        k.quit();
        return output;
    });

    expect(result.chars).toEqual([["👨‍👩‍👧‍👦a", 0], ["b", 2]]);
    expect(result.seen).toEqual([[0, "👨‍👩‍👧‍👦a"], [2, "b"]]);
});

test("string mappings and undeclared sequences stay character based", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = (globalThis as any).kaplay({
            global: false,
            width: 160,
            height: 100,
        });
        const svg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"30\" height=\"10\"><rect width=\"30\" height=\"10\" fill=\"white\"/></svg>";
        const src = `data:image/svg+xml;charset=utf-8,${
            encodeURIComponent(svg)
        }`;
        const declaredAsset = k.loadBitmapFont(
            "declared-grid-scope",
            src,
            10,
            10,
            {
                chars: ["f", "i", "fi"],
            },
        );
        const declaredFont = await new Promise((accept, reject) => {
            declaredAsset.onLoad(accept);
            declaredAsset.onError(reject);
        });
        k.formatText({ text: "fi", font: declaredFont });
        const asset = k.loadBitmapFont(null, src, 10, 10, { chars: "fix" });
        const font = await new Promise((accept, reject) => {
            asset.onLoad(accept);
            asset.onError(reject);
        });
        const formatted = k.formatText({ text: "fix", font });
        const output = formatted.chars.map((ch: any) => [ch.ch, ch.textCursor]);
        k.quit();
        return output;
    });

    expect(result).toEqual([["f", 0], ["i", 1], ["x", 2]]);
});
