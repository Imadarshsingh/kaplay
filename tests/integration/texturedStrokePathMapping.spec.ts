import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: "dist/kaplay.js" });
});

function expectPixel(actual: number[], expected: number[], tolerance = 8) {
    expect(actual).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
        expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(
            tolerance,
        );
    }
}

function pixelMatches(actual: number[], expected: number[], tolerance = 8) {
    return actual.length === 4
        && actual.every((value, index) =>
            Math.abs(value - expected[index]) <= tolerance
        );
}

function expectPixelPair(
    actual: [number[], number[]],
    expected: [number[], number[]],
) {
    const forward = pixelMatches(actual[0], expected[0])
        && pixelMatches(actual[1], expected[1]);
    const reversed = pixelMatches(actual[0], expected[1])
        && pixelMatches(actual[1], expected[0]);
    expect(forward || reversed).toBe(true);
}

for (const surface of ["default-miter component", "round direct"] as const) {
    test(`keeps a selected frame continuous around a closed ${surface} outline`, async ({ page }) => {
        const pixels = await page.evaluate(async (surface) => {
            const k = kaplay({
                global: false,
                width: 128,
                height: 88,
                pixelDensity: 1,
                background: [0, 0, 0],
                debug: false,
            });
            const source = document.createElement("canvas");
            source.width = 16;
            source.height = 2;
            const context = source.getContext("2d")!;
            const data = context.createImageData(16, 2);
            const colors = [
                [255, 0, 0, 255],
                [0, 255, 0, 255],
                [0, 0, 255, 255],
                [255, 255, 0, 255],
            ];
            for (let y = 0; y < 2; y++) {
                for (let x = 0; x < 16; x++) {
                    data.data.set(
                        x < 8
                            ? [255, 0, 255, 255]
                            : colors[Math.floor((x - 8) / 2)],
                        (y * 16 + x) * 4,
                    );
                }
            }
            context.putImageData(data, 0, 0);
            await k.loadSprite("closed-join", source, {
                sliceX: 2,
                singular: true,
                filter: "nearest",
            });
            const pts = [
                k.vec2(0),
                k.vec2(88, 0),
                k.vec2(88, 56),
                k.vec2(0, 56),
            ];
            if (surface === "round direct") {
                k.onDraw(() =>
                    k.drawPolygon({
                        pos: k.vec2(20, 16),
                        pts,
                        fill: false,
                        outline: {
                            width: 10,
                            join: "round",
                            color: k.WHITE,
                            texture: "closed-join",
                            frame: 1,
                            textureMapping: "path",
                        },
                    })
                );
            }
            else {
                k.add([
                    k.pos(20, 16),
                    k.polygon(pts, { fill: false }),
                    k.outline(10, k.WHITE, 1, undefined, 10, "butt", {
                        texture: "closed-join",
                        frame: 1,
                        textureMapping: "path",
                    }),
                ]);
            }
            await new Promise<void>(resolve => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                );
            });
            const image = new Image();
            image.src = k.screenshot();
            await image.decode();
            const output = document.createElement("canvas");
            output.width = 128;
            output.height = 88;
            const outputContext = output.getContext("2d")!;
            outputContext.drawImage(image, 0, 0);
            // Sample segment interiors on all four sides, including both sides
            // of the closure. No corner triangulation or seam pixel is pinned.
            return [[40, 16], [64, 16], [108, 44], [64, 72], [20, 44], [20, 32]]
                .map(([x, y]) =>
                    Array.from(outputContext.getImageData(x, y, 1, 1).data)
                );
        }, surface);
        [
            [255, 0, 0, 255],
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
            [255, 255, 0, 255],
        ].forEach((expected, index) => expectPixel(pixels[index], expected));
    });
}

test("keeps bounds mapping as the default for textured strokes", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 64,
            height: 64,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 4;
        source.height = 1;
        const context = source.getContext("2d")!;
        const data = context.createImageData(4, 1);
        data.data.set([
            255,
            0,
            0,
            255,
            0,
            255,
            0,
            255,
            0,
            0,
            255,
            255,
            255,
            255,
            0,
            255,
        ]);
        context.putImageData(data, 0, 0);
        await k.loadSprite("bounds-pattern", source, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawLines({
                pts: [k.vec2(8, 8), k.vec2(40, 8), k.vec2(40, 56)],
                width: 8,
                join: "miter",
                texture: "bounds-pattern",
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 64;
        output.height = 64;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [[20, 8], [40, 20]].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    expectPixel(pixels[0], [0, 255, 0, 255]);
    expectPixel(pixels[1], [255, 255, 0, 255]);
});

test("maps a selected frame along and across a diagonal stroke", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 112,
            height: 112,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 4;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(4, 2);
        data.data.set([
            255,
            0,
            0,
            255,
            0,
            255,
            0,
            255,
            0,
            255,
            255,
            255,
            255,
            0,
            255,
            255,
            0,
            0,
            255,
            255,
            255,
            255,
            0,
            255,
            255,
            255,
            255,
            255,
            96,
            96,
            96,
            255,
        ]);
        context.putImageData(data, 0, 0);
        await k.loadSprite("diagonal-pattern", source, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.pushTransform();
            k.pushScale(k.vec2(2));
            k.drawLine({
                p1: k.vec2(12, 12),
                p2: k.vec2(44, 44),
                width: 8,
                texture: "diagonal-pattern",
                frame: 1,
                textureMapping: "path",
            });
            k.popTransform();
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 112;
        output.height = 112;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [43, 37],
            [75, 69],
            [37, 43],
            [69, 75],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    expectPixelPair(
        [pixels[0], pixels[2]],
        [[0, 255, 255, 255], [255, 255, 255, 255]],
    );
    expectPixelPair(
        [pixels[1], pixels[3]],
        [[255, 0, 255, 255], [96, 96, 96, 255]],
    );
});

test("keeps one longitudinal progression over an unequal zigzag", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 144,
            height: 72,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 8;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(8, 2);
        const colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 8; x++) {
                data.data.set(colors[Math.floor(x / 2)], (y * 8 + x) * 4);
            }
        }
        context.putImageData(data, 0, 0);
        await k.loadSprite("path-pattern", source, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawLines({
                pts: [
                    k.vec2(16, 16),
                    k.vec2(112, 16),
                    k.vec2(112, 48),
                    k.vec2(48, 48),
                ],
                width: 12,
                join: "bevel",
                cap: "butt",
                texture: "path-pattern",
                textureMapping: "path",
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 144;
        output.height = 72;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [56, 16],
            [112, 32],
            [80, 48],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ].forEach((expected, index) => expectPixel(pixels[index], expected));
});

test("keeps one longitudinal progression through miter joins", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 144,
            height: 72,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 8;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(8, 2);
        const colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 8; x++) {
                data.data.set(colors[Math.floor(x / 2)], (y * 8 + x) * 4);
            }
        }
        context.putImageData(data, 0, 0);
        await k.loadSprite("miter-path-pattern", source, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawLines({
                pts: [
                    k.vec2(16, 16),
                    k.vec2(112, 16),
                    k.vec2(112, 48),
                    k.vec2(48, 48),
                ],
                width: 12,
                join: "miter",
                cap: "butt",
                texture: "miter-path-pattern",
                textureMapping: "path",
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 144;
        output.height = 72;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [56, 16],
            [112, 32],
            [80, 48],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ].forEach((expected, index) => expectPixel(pixels[index], expected));
});

test("keeps path endpoints aligned when square caps extend the geometry", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 48,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 16;
        source.height = 1;
        const context = source.getContext("2d")!;
        const data = context.createImageData(16, 1);
        const colors = Array.from(
            { length: 16 },
            () => [128, 128, 128, 255],
        );
        colors[0] = [255, 0, 0, 255];
        colors[1] = [0, 255, 0, 255];
        colors[14] = [0, 0, 255, 255];
        colors[15] = [255, 255, 0, 255];
        colors.forEach((color, x) => data.data.set(color, x * 4));
        context.putImageData(data, 0, 0);
        await k.loadSprite("capped-path", source, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawLines({
                pts: [k.vec2(24, 24), k.vec2(104, 24)],
                width: 16,
                cap: "square",
                texture: "capped-path",
                textureMapping: "path",
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 128;
        output.height = 48;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [[25, 24], [103, 24]].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    expectPixel(pixels[0], [255, 0, 0, 255]);
    expectPixel(pixels[1], [255, 255, 0, 255]);
});

test("keeps a tinted closed outline continuous through its closing segment", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 88,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 8;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(8, 2);
        const colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 8; x++) {
                data.data.set(colors[Math.floor(x / 2)], (y * 8 + x) * 4);
            }
        }
        context.putImageData(data, 0, 0);
        await k.loadSprite("outline-path", source, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawPolygon({
                pts: [
                    k.vec2(20, 16),
                    k.vec2(108, 16),
                    k.vec2(108, 72),
                    k.vec2(20, 72),
                ],
                fill: false,
                opacity: 0.5,
                outline: {
                    width: 10,
                    join: "bevel",
                    color: k.rgb(128, 255, 255),
                    texture: "outline-path",
                    textureMapping: "path",
                },
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 128;
        output.height = 88;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [64, 16],
            [108, 44],
            [64, 72],
            [20, 44],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    [
        [64, 0, 0, 255],
        [0, 128, 0, 255],
        [0, 0, 128, 255],
        [64, 128, 0, 255],
    ].forEach((expected, index) => expectPixel(pixels[index], expected));
});

test("maps an outline component texture continuously around its path", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 88,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 8;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(8, 2);
        const colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 8; x++) {
                data.data.set(colors[Math.floor(x / 2)], (y * 8 + x) * 4);
            }
        }
        context.putImageData(data, 0, 0);
        await k.loadSprite("component-outline-path", source, {
            singular: true,
            filter: "nearest",
        });

        k.add([
            k.pos(20, 16),
            k.polygon([
                k.vec2(0, 0),
                k.vec2(88, 0),
                k.vec2(88, 56),
                k.vec2(0, 56),
            ], { fill: false }),
            k.outline(10, k.WHITE, 1, "bevel", 10, "butt", {
                texture: "component-outline-path",
                textureMapping: "path",
            }),
        ]);

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 128;
        output.height = 88;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [64, 16],
            [108, 44],
            [64, 72],
            [20, 44],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ].forEach((expected, index) => expectPixel(pixels[index], expected));
});
