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

test("maps atlas frames across generated vector fills", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 160,
            height: 80,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 4;
        source.height = 2;
        const sourceContext = source.getContext("2d")!;
        const data = sourceContext.createImageData(4, 2);
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
        sourceContext.putImageData(data, 0, 0);
        k.loadSprite("pattern", source, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawRect({
                pos: k.vec2(0, 0),
                width: 32,
                height: 32,
                texture: "pattern",
            });
            k.drawRect({
                pos: k.vec2(40, 0),
                width: 32,
                height: 32,
                radius: 8,
                texture: "pattern",
                frame: 1,
            });
            k.drawCircle({
                pos: k.vec2(96, 16),
                radius: 16,
                texture: "pattern",
            });
            k.drawEllipse({
                pos: k.vec2(136, 16),
                radiusX: 16,
                radiusY: 12,
                texture: "pattern",
                frame: 1,
            });
            k.drawEllipse({
                pos: k.vec2(32, 56),
                radiusX: 16,
                radiusY: 12,
                start: 0,
                end: 180,
                texture: "pattern",
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 80;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return [
            [8, 8],
            [24, 8],
            [8, 24],
            [24, 24],
            [50, 10],
            [62, 10],
            [50, 22],
            [62, 22],
            [90, 10],
            [102, 10],
            [90, 22],
            [102, 22],
            [130, 12],
            [142, 12],
            [130, 20],
            [142, 20],
            [26, 59],
            [38, 59],
            [26, 65],
            [38, 65],
        ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    });

    const first = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ];
    const second = [
        [0, 255, 255, 255],
        [255, 0, 255, 255],
        [255, 255, 255, 255],
        [96, 96, 96, 255],
    ];
    [...first, ...second, ...first, ...second, ...first].forEach(
        (expected, index) => {
            expectPixel(pixels[index], expected);
        },
    );
});

test("keeps anchored texture mapping stable under camera movement", async ({ page }) => {
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
        source.width = 2;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(2, 2);
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
        k.loadSprite("camera-pattern", source, {
            singular: true,
            filter: "nearest",
        });
        k.setCamPos(160, 96);
        k.onDraw(() => {
            k.drawRect({
                pos: k.vec2(160, 96),
                width: 32,
                height: 32,
                anchor: "center",
                texture: "camera-pattern",
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
        return [[24, 24], [40, 24], [24, 40], [40, 40]].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    const expected = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ];
    expected.forEach((value, index) => expectPixel(pixels[index], value));
});

test("maps textures over line, join, cap, and outline geometry bounds", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 160,
            height: 96,
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
        k.loadSprite("stroke", source, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawLine({
                p1: k.vec2(8, 16),
                p2: k.vec2(40, 16),
                width: 16,
                texture: "stroke",
                color: k.rgb(128, 255, 255),
                opacity: 0.5,
            });
            k.drawLine({
                p1: k.vec2(72, 8),
                p2: k.vec2(72, 40),
                width: 16,
                texture: "stroke",
                frame: 1,
            });
            k.drawLines({
                pts: [k.vec2(104, 8), k.vec2(136, 8), k.vec2(136, 40)],
                width: 8,
                join: "miter",
                cap: "square",
                texture: "stroke",
                frame: 1,
            });
            k.drawRect({
                pos: k.vec2(24, 56),
                width: 40,
                height: 28,
                radius: 6,
                fill: false,
                outline: {
                    width: 8,
                    join: "round",
                    texture: "stroke",
                    color: k.rgb(255, 128, 255),
                    opacity: 0.5,
                },
            });
            k.add([
                k.pos(96, 56),
                k.rect(40, 28, { fill: false }),
                k.outline(8, k.WHITE, 1, "round", 10, "butt", {
                    texture: "stroke",
                    frame: 1,
                }),
            ]);
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 160;
        output.height = 96;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [16, 12],
            [32, 12],
            [16, 20],
            [32, 20],
            [68, 16],
            [76, 16],
            [68, 32],
            [76, 32],
            [112, 6],
            [134, 16],
            [136, 32],
            [36, 58],
            [52, 58],
            [36, 82],
            [52, 82],
            [100, 58],
            [132, 58],
            [100, 82],
            [132, 82],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    const expected = [
        [64, 0, 0, 255],
        [0, 128, 0, 255],
        [0, 0, 128, 255],
        [64, 128, 0, 255],
        [0, 255, 255, 255],
        [255, 0, 255, 255],
        [255, 255, 255, 255],
        [96, 96, 96, 255],
        [0, 255, 255, 255],
        [255, 0, 255, 255],
        [96, 96, 96, 255],
        [128, 0, 0, 255],
        [0, 64, 0, 255],
        [0, 0, 128, 255],
        [128, 64, 0, 255],
        [0, 255, 255, 255],
        [255, 0, 255, 255],
        [255, 255, 255, 255],
        [96, 96, 96, 255],
    ];
    expected.forEach((value, index) => expectPixel(pixels[index], value));
});

test("preserves outline opacity precedence with and without textures", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 64,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const blue = document.createElement("canvas");
        blue.width = 1;
        blue.height = 1;
        blue.getContext("2d")!.fillStyle = "blue";
        blue.getContext("2d")!.fillRect(0, 0, 1, 1);
        k.loadSprite("outline-blue", blue, {
            singular: true,
            filter: "nearest",
        });

        k.onDraw(() => {
            k.drawRect({
                pos: k.vec2(8, 8),
                width: 40,
                height: 40,
                fill: false,
                opacity: 0.25,
                outline: {
                    width: 8,
                    color: k.WHITE,
                    opacity: 0.75,
                    join: "miter",
                    texture: "outline-blue",
                },
            });
            k.drawRect({
                pos: k.vec2(72, 8),
                width: 40,
                height: 40,
                fill: false,
                opacity: 0.25,
                outline: {
                    width: 8,
                    color: k.BLUE,
                    opacity: 0.75,
                    join: "miter",
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
        output.height = 64;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [28, 8],
            [92, 8],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    pixels.forEach(pixel => expectPixel(pixel, [0, 0, 64, 255]));
});

test("composes the complete RGB tint across bevel strokes and outlines", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 176,
            height: 72,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 1;
        source.height = 1;
        source.getContext("2d")!.fillStyle = "rgb(128, 255, 128)";
        source.getContext("2d")!.fillRect(0, 0, 1, 1);
        k.loadSprite("bevel-source", source, {
            singular: true,
            filter: "nearest",
        });
        const tint = k.rgb(96, 160, 32);

        k.onDraw(() => {
            k.drawLines({
                pts: [k.vec2(12, 48), k.vec2(48, 16), k.vec2(84, 48)],
                width: 16,
                join: "bevel",
                texture: "bevel-source",
                color: tint,
            });
            k.drawPolygon({
                pos: k.vec2(112, 16),
                pts: [k.vec2(0), k.vec2(40, 0), k.vec2(40), k.vec2(0, 40)],
                fill: false,
                outline: {
                    width: 12,
                    join: "bevel",
                    texture: "bevel-source",
                    color: tint,
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
        output.width = 176;
        output.height = 72;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [30, 32],
            [132, 16],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    pixels.forEach(pixel => expectPixel(pixel, [48, 160, 16, 255]));
});

test("accepts every sprite source form and preserves untextured draws", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 200,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        k.loadShader(
            "solid-red",
            null,
            `vec4 frag(vec2 pos, vec2 uv, vec4 color, sampler2D tex) {
                return vec4(1.0, 0.0, 0.0, 1.0);
            }`,
        );
        const source = document.createElement("canvas");
        source.width = 1;
        source.height = 1;
        source.getContext("2d")!.fillStyle = "red";
        source.getContext("2d")!.fillRect(0, 0, 1, 1);
        const asset = k.loadSprite("source", source, {
            singular: true,
            filter: "nearest",
        });
        const sources = ["source", asset.data!, asset];
        const centers = [16, 48, 80];

        k.onDraw(() => {
            for (let index = 0; index < sources.length; index++) {
                const texture = sources[index];
                const x = centers[index];
                k.drawRect({
                    pos: k.vec2(x - 8, 4),
                    width: 16,
                    height: 16,
                    texture,
                });
                k.drawCircle({
                    pos: k.vec2(x, 36),
                    radius: 8,
                    texture,
                });
                k.drawEllipse({
                    pos: k.vec2(x, 60),
                    radiusX: 8,
                    radiusY: 6,
                    texture,
                });
                k.drawPolygon({
                    pos: k.vec2(x - 8, 76),
                    pts: [
                        k.vec2(0),
                        k.vec2(16, 0),
                        k.vec2(16),
                        k.vec2(0, 16),
                    ],
                    texture,
                });
                k.drawLine({
                    p1: k.vec2(x - 8, 108),
                    p2: k.vec2(x + 8, 108),
                    width: 8,
                    texture,
                });
                k.drawLines({
                    pts: [
                        k.vec2(x - 8, 132),
                        k.vec2(x + 8, 132),
                        k.vec2(x + 8, 140),
                    ],
                    width: 8,
                    texture,
                });
            }

            const x = 112;
            k.drawRect({
                pos: k.vec2(x - 8, 4),
                width: 16,
                height: 16,
                color: k.GREEN,
            });
            k.drawCircle({ pos: k.vec2(x, 36), radius: 8, color: k.GREEN });
            k.drawEllipse({
                pos: k.vec2(x, 60),
                radiusX: 8,
                radiusY: 6,
                color: k.GREEN,
            });
            k.drawPolygon({
                pos: k.vec2(x - 8, 76),
                pts: [
                    k.vec2(0),
                    k.vec2(16, 0),
                    k.vec2(16),
                    k.vec2(0, 16),
                ],
                color: k.GREEN,
            });
            k.drawLine({
                p1: k.vec2(x - 8, 108),
                p2: k.vec2(x + 8, 108),
                width: 8,
                color: k.GREEN,
            });
            k.drawLines({
                pts: [
                    k.vec2(x - 8, 132),
                    k.vec2(x + 8, 132),
                    k.vec2(x + 8, 140),
                ],
                width: 8,
                color: k.GREEN,
            });
            k.drawRect({
                pos: k.vec2(8, 152),
                width: 40,
                height: 40,
                color: k.GREEN,
                outline: { width: 6, color: k.BLUE },
                shader: "solid-red",
            });
        });

        k.add([
            k.pos(72, 152),
            k.rect(40, 40),
            k.color(k.GREEN),
            k.outline(6, k.BLUE),
            k.shader("solid-red"),
        ]);

        for (let frame = 0; frame < 4; frame++) {
            await new Promise<void>(resolve =>
                requestAnimationFrame(() => resolve())
            );
        }
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 128;
        output.height = 200;
        const context = output.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return {
            sourceForms: [16, 48, 80, 112].flatMap(x =>
                [12, 36, 60, 84, 108, 132].map(y =>
                    Array.from(context.getImageData(x, y, 1, 1).data)
                )
            ),
            shaderFills: [[28, 172], [92, 172]].map(([x, y]) =>
                Array.from(context.getImageData(x, y, 1, 1).data)
            ),
            shaderOutlines: [[8, 172], [72, 172]].map(([x, y]) =>
                Array.from(context.getImageData(x, y, 1, 1).data)
            ),
        };
    });

    pixels.sourceForms.slice(0, 18).forEach(pixel => {
        expectPixel(pixel, [255, 0, 0, 255]);
    });
    pixels.sourceForms.slice(18).forEach(pixel => {
        expectPixel(pixel, [0, 255, 0, 255]);
    });
    pixels.shaderFills.forEach(pixel => {
        expectPixel(pixel, [255, 0, 0, 255]);
    });
    pixels.shaderOutlines.forEach(pixel => {
        expectPixel(pixel, [0, 0, 255, 255]);
    });
});

test("keeps textures local under transforms and composes tint and opacity", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 152,
            height: 64,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 2;
        source.height = 2;
        const context = source.getContext("2d")!;
        const data = context.createImageData(2, 2);
        data.data.set([
            255,
            255,
            255,
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
        k.loadSprite("pattern", source, { singular: true, filter: "nearest" });
        const white = document.createElement("canvas");
        white.width = 1;
        white.height = 1;
        white.getContext("2d")!.fillStyle = "white";
        white.getContext("2d")!.fillRect(0, 0, 1, 1);
        k.loadSprite("white", white, { singular: true, filter: "nearest" });

        k.onDraw(() => {
            k.drawPolygon({
                pos: k.vec2(24, 32),
                angle: 90,
                scale: k.vec2(1.5, 1),
                skew: k.vec2(0.1, 0),
                offset: k.vec2(-16, -16),
                pts: [k.vec2(0), k.vec2(32, 0), k.vec2(32), k.vec2(0, 32)],
                texture: "pattern",
                color: k.rgb(128, 255, 255),
                opacity: 0.5,
            });
            k.drawRect({
                pos: k.vec2(72, 8),
                width: 32,
                height: 32,
                texture: "pattern",
                gradient: [k.rgb(255, 0, 0), k.rgb(0, 0, 255)],
            });
            k.drawPolygon({
                pos: k.vec2(112, 8),
                pts: [k.vec2(0), k.vec2(32, 0), k.vec2(32), k.vec2(0, 32)],
                texture: "white",
                colors: [
                    k.rgb(255, 0, 0),
                    k.rgb(255, 0, 0),
                    k.rgb(0, 0, 255),
                    k.rgb(0, 0, 255),
                ],
                opacities: [0.5, 0.5, 0.5, 0.5],
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 152;
        output.height = 64;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return {
            transformed: [
                Array.from(outputContext.getImageData(34, 20, 1, 1).data),
                Array.from(outputContext.getImageData(34, 44, 1, 1).data),
            ],
            gradient: [
                Array.from(outputContext.getImageData(80, 12, 1, 1).data),
                Array.from(outputContext.getImageData(80, 36, 1, 1).data),
            ],
            vertexColors: [
                Array.from(outputContext.getImageData(128, 12, 1, 1).data),
                Array.from(outputContext.getImageData(128, 36, 1, 1).data),
            ],
        };
    });

    expectPixel(result.transformed[0], [64, 128, 128, 255]);
    expectPixel(result.transformed[1], [0, 128, 0, 255]);
    expect(result.gradient[0][0]).toBeGreaterThan(result.gradient[0][2]);
    expect(result.gradient[1][2]).toBeGreaterThan(result.gradient[1][0]);
    expect(result.vertexColors[0][0]).toBeGreaterThan(
        result.vertexColors[0][2],
    );
    expect(result.vertexColors[0][0]).toBeGreaterThan(80);
    expect(result.vertexColors[0][0]).toBeLessThan(150);
    expect(result.vertexColors[1][2]).toBeGreaterThan(
        result.vertexColors[1][0],
    );
    expect(result.vertexColors[1][2]).toBeGreaterThan(80);
    expect(result.vertexColors[1][2]).toBeLessThan(150);
});

test("composes circle and ellipse textures with tint, opacity, and radial gradient", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 224,
            height: 64,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = source.height = 2;
        const context = source.getContext("2d")!;
        context.fillStyle = "rgb(200,160,120)";
        context.fillRect(0, 0, 2, 2);
        await k.loadSprite("curved-composition", source, {
            singular: true,
            filter: "nearest",
        });
        k.onDraw(() => {
            k.drawCircle({
                pos: k.vec2(32, 32),
                radius: 24,
                texture: "curved-composition",
                color: k.rgb(128, 192, 64),
                opacity: 0.5,
            });
            k.drawEllipse({
                pos: k.vec2(104, 32),
                radiusX: 28,
                radiusY: 20,
                texture: "curved-composition",
                color: k.rgb(128, 192, 64),
                opacity: 0.5,
            });
            k.drawEllipse({
                pos: k.vec2(184, 32),
                radiusX: 28,
                radiusY: 20,
                texture: "curved-composition",
                gradient: [k.RED, k.BLUE],
                opacity: 0.5,
            });
        });
        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 224;
        output.height = 64;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [[34, 32], [106, 32], [186, 32], [205, 32]].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });
    expectPixel(pixels[0], [50, 60, 15, 255]);
    expectPixel(pixels[1], [50, 60, 15, 255]);
    // Radial interpolation must retain different center and rim colors;
    // inequalities leave room for equivalent curve tessellations.
    expect(pixels[2][0]).toBeGreaterThan(75);
    expect(pixels[2][2]).toBeLessThan(15);
    expect(pixels[3][0]).toBeLessThan(40);
    expect(pixels[3][2]).toBeGreaterThan(35);
});

test("shape components honor and expose mutable texture sources and frames", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 168,
            height: 80,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const sourceA = document.createElement("canvas");
        sourceA.width = 2;
        sourceA.height = 1;
        const contextA = sourceA.getContext("2d")!;
        const dataA = contextA.createImageData(2, 1);
        dataA.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
        contextA.putImageData(dataA, 0, 0);
        const sourceB = document.createElement("canvas");
        sourceB.width = 2;
        sourceB.height = 1;
        const contextB = sourceB.getContext("2d")!;
        const dataB = contextB.createImageData(2, 1);
        dataB.data.set([255, 255, 0, 255, 0, 0, 255, 255]);
        contextB.putImageData(dataB, 0, 0);
        const firstAsset = k.loadSprite("first", sourceA, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });
        const secondAsset = k.loadSprite("second", sourceB, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });

        const objects = [
            k.add([
                k.pos(0, 0),
                k.rect(24, 24, { texture: "first" }),
            ]),
            k.add([
                k.pos(40, 12),
                k.circle(12, { texture: firstAsset.data! }),
            ]),
            k.add([
                k.pos(72, 12),
                k.ellipse(12, 10, { texture: firstAsset }),
            ]),
            k.add([
                k.pos(96, 0),
                k.polygon([
                    k.vec2(0),
                    k.vec2(24, 0),
                    k.vec2(24),
                    k.vec2(0, 24),
                ], { texture: "first" }),
            ]),
        ];
        const outlined = k.add([
            k.pos(136, 0),
            k.rect(24, 24, { fill: false }),
            k.outline(6, k.WHITE, 1, "miter", 10, "butt", {
                texture: firstAsset,
            }),
        ]);
        const waitFrames = () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                );
            });
        const read = async (points: [number, number][]) => {
            await waitFrames();
            const image = new Image();
            image.src = k.screenshot();
            await image.decode();
            const output = document.createElement("canvas");
            output.width = 168;
            output.height = 80;
            const outputContext = output.getContext("2d")!;
            outputContext.drawImage(image, 0, 0);
            return points.map(([x, y]) =>
                Array.from(outputContext.getImageData(x, y, 1, 1).data)
            );
        };
        const originalPoints: [number, number][] = [
            [12, 12],
            [40, 12],
            [72, 12],
            [108, 12],
            [148, 2],
        ];
        const defaultFrames = [
            ...objects.map(object => object.frame),
            outlined.outline.frame,
        ];
        const before = await read(originalPoints);
        for (const object of objects) {
            object.frame = 1;
        }
        outlined.outline.frame = 1;
        const afterFrame = await read(originalPoints);
        for (const object of objects) {
            object.frame = 0;
        }
        outlined.outline.frame = 0;
        const afterFrameReset = await read(originalPoints);
        for (const object of objects) {
            object.frame = 1;
        }
        outlined.outline.frame = 1;
        objects[0].texture = "second";
        objects[1].texture = secondAsset.data!;
        objects[2].texture = secondAsset;
        objects[3].texture = "second";
        outlined.outline.texture = secondAsset;
        const afterTexture = await read(originalPoints);

        const compositionErrors: string[] = [];
        const useAfterOutline = (component: any) => {
            const object = k.add([
                k.pos(-100, -100),
                k.outline(2),
            ]);
            try {
                object.use(component);
            } catch (error) {
                compositionErrors.push(String(error));
            }
            object.destroy();
        };
        useAfterOutline(k.rect(8, 8));
        useAfterOutline(k.circle(4));
        useAfterOutline(k.sprite("first"));

        const removedOutline = k.add([
            k.pos(-100, -100),
            k.outline(2),
        ]);
        removedOutline.unuse("outline");
        try {
            removedOutline.use(k.rect(8, 8));
        } catch (error) {
            compositionErrors.push(String(error));
        }
        removedOutline.destroy();

        return {
            defaultFrames,
            before,
            afterFrame,
            afterFrameReset,
            afterTexture,
            compositionErrors,
        };
    });

    expect(result.defaultFrames).toEqual([0, 0, 0, 0, 0]);
    result.before.forEach(pixel => expectPixel(pixel, [255, 0, 0, 255]));
    result.afterFrame.forEach(pixel => expectPixel(pixel, [0, 255, 0, 255]));
    result.afterFrameReset.forEach(pixel =>
        expectPixel(pixel, [255, 0, 0, 255])
    );
    result.afterTexture.forEach(pixel => expectPixel(pixel, [0, 0, 255, 255]));
    expect(result.compositionErrors).toEqual([]);
});

test("prefab shape components preserve sprite names and frames", async ({ page }) => {
    const pixels = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 80,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const sourceA = document.createElement("canvas");
        sourceA.width = 2;
        sourceA.height = 1;
        const contextA = sourceA.getContext("2d")!;
        const dataA = contextA.createImageData(2, 1);
        dataA.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
        contextA.putImageData(dataA, 0, 0);
        const sourceB = document.createElement("canvas");
        sourceB.width = 2;
        sourceB.height = 1;
        const contextB = sourceB.getContext("2d")!;
        const dataB = contextB.createImageData(2, 1);
        dataB.data.set([255, 255, 0, 255, 0, 0, 255, 255]);
        contextB.putImageData(dataB, 0, 0);
        await k.loadSprite("first", sourceA, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });
        await k.loadSprite("second", sourceB, {
            sliceX: 2,
            singular: true,
            filter: "nearest",
        });

        const prefabRect = k.add([
            k.pos(-100, -100),
            k.rect(8, 8, { texture: "first" }),
        ]);
        prefabRect.texture = "second";
        prefabRect.frame = 1;
        const restoredRect = k.addPrefab(prefabRect.serialize());
        const prefabCircle = k.add([
            k.pos(-100, -100),
            k.circle(4, { texture: "first" }),
        ]);
        prefabCircle.texture = "second";
        prefabCircle.frame = 1;
        const restoredCircle = k.addPrefab(prefabCircle.serialize());
        const prefabEllipse = k.add([
            k.pos(-100, -100),
            k.ellipse(4, 3, { texture: "first" }),
        ]);
        prefabEllipse.texture = "second";
        prefabEllipse.frame = 1;
        const restoredEllipse = k.addPrefab(prefabEllipse.serialize());
        const prefabOutline = k.add([
            k.pos(-100, -100),
            k.rect(16, 16, { fill: false }),
            k.outline(4, k.WHITE, 1, "miter", 10, "butt", {
                texture: "first",
            }),
        ]);
        prefabOutline.outline.texture = "second";
        prefabOutline.outline.frame = 1;
        const restoredOutline = k.addPrefab(prefabOutline.serialize());

        restoredRect.pos = k.vec2(8, 56);
        restoredCircle.pos = k.vec2(40, 60);
        restoredEllipse.pos = k.vec2(72, 60);
        restoredOutline.pos = k.vec2(104, 52);
        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 128;
        output.height = 80;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return [
            [12, 60],
            [40, 60],
            [72, 60],
            [112, 52],
        ].map(([x, y]) =>
            Array.from(outputContext.getImageData(x, y, 1, 1).data)
        );
    });

    pixels.forEach(pixel => expectPixel(pixel, [0, 0, 255, 255]));
});

test("keeps named and direct sprite draws hidden until loading finishes", async ({ page }) => {
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>(resolve => {
        releaseRequest = resolve;
    });
    await page.route("https://assets.test/slow-texture.svg", async route => {
        await requestGate;
        await route.fulfill({
            contentType: "image/svg+xml",
            headers: { "access-control-allow-origin": "*" },
            body:
                "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"><rect width=\"2\" height=\"2\" fill=\"rgb(255,0,0)\"/></svg>",
        });
    });

    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            width: 80,
            height: 48,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
            loadingScreen: false,
        });
        const asset = k.loadSprite(
            "slow",
            "https://assets.test/slow-texture.svg",
            {
                singular: true,
                filter: "nearest",
            },
        );
        let pendingError = "";
        k.onDraw(() => {
            try {
                k.drawRect({
                    pos: k.vec2(2, 4),
                    width: 16,
                    height: 16,
                    texture: asset,
                });
                k.drawRect({
                    pos: k.vec2(22, 4),
                    width: 16,
                    height: 16,
                    texture: "slow",
                });
                k.drawLine({
                    p1: k.vec2(2, 32),
                    p2: k.vec2(18, 32),
                    width: 8,
                    texture: asset,
                });
                k.drawLines({
                    pts: [
                        k.vec2(26, 32),
                        k.vec2(42, 32),
                        k.vec2(42, 44),
                    ],
                    width: 8,
                    texture: "slow",
                });
            } catch (error) {
                pendingError = String(error);
            }
        });
        (window as any).__pendingTexture = {
            k,
            asset,
            pendingError: () => pendingError,
        };
    });

    const read = () =>
        page.evaluate(async () => {
            const state = (window as any).__pendingTexture;
            await new Promise<void>(resolve => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                );
            });
            const image = new Image();
            image.src = state.k.screenshot();
            await image.decode();
            const output = document.createElement("canvas");
            output.width = 80;
            output.height = 48;
            const context = output.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return {
                pendingError: state.pendingError(),
                pixels: [[0, 12], [10, 12], [30, 12], [10, 32], [34, 32]]
                    .map(([x, y]) =>
                        Array.from(context.getImageData(x, y, 1, 1).data)
                    ),
            };
        });

    const pending = await read();
    expect(pending.pendingError).toBe("");
    pending.pixels.slice(1).forEach(pixel => {
        expect(pixel).toEqual(pending.pixels[0]);
    });

    releaseRequest();
    await page.evaluate(() =>
        new Promise<void>((resolve, reject) => {
            const asset = (window as any).__pendingTexture.asset;
            asset.onLoad(() => resolve());
            asset.onError((error: Error) => reject(error));
        })
    );

    const loaded = await read();
    expect(loaded.pendingError).toBe("");
    loaded.pixels.slice(1).forEach(pixel =>
        expectPixel(pixel, [255, 0, 0, 255])
    );
});

test("matches sprite asset errors and preserves explicit polygon UVs", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 96,
            height: 48,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const red = document.createElement("canvas");
        red.width = 1;
        red.height = 1;
        red.getContext("2d")!.fillStyle = "red";
        red.getContext("2d")!.fillRect(0, 0, 1, 1);
        const blue = document.createElement("canvas");
        blue.width = 1;
        blue.height = 1;
        blue.getContext("2d")!.fillStyle = "blue";
        blue.getContext("2d")!.fillRect(0, 0, 1, 1);
        const redAsset = k.loadSprite("red", red, {
            singular: true,
            filter: "nearest",
        });
        k.loadSprite("blue", blue, { singular: true, filter: "nearest" });

        k.onDraw(() => {
            const frame = k.getSprite("red")!.data!.frames[0];
            k.drawPolygon({
                pos: k.vec2(0, 0),
                pts: [k.vec2(0), k.vec2(24, 0), k.vec2(24), k.vec2(0, 24)],
                texture: "blue",
                tex: frame.tex,
                uv: [
                    k.vec2(frame.q.x, frame.q.y),
                    k.vec2(frame.q.x + frame.q.w, frame.q.y),
                    k.vec2(frame.q.x + frame.q.w, frame.q.y + frame.q.h),
                    k.vec2(frame.q.x, frame.q.y + frame.q.h),
                ],
            });
            k.drawRect({
                pos: k.vec2(32, 0),
                width: 16,
                height: 24,
                texture: redAsset,
            });
            k.drawRect({
                pos: k.vec2(56, 0),
                width: 16,
                height: 24,
                texture: redAsset.data!,
            });
            k.drawRect({
                pos: k.vec2(80, 0),
                width: 16,
                height: 24,
                color: k.GREEN,
            });
            k.drawLine({
                p1: k.vec2(8, 40),
                p2: k.vec2(64, 40),
                width: 8,
                color: k.MAGENTA,
            });
        });

        await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const image = new Image();
        image.src = k.screenshot();
        await image.decode();
        const output = document.createElement("canvas");
        output.width = 96;
        output.height = 48;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        const pixels = [[12, 12], [40, 12], [64, 12], [88, 12], [32, 40]].map((
            [x, y],
        ) => Array.from(outputContext.getImageData(x, y, 1, 1).data));

        let shapeMissing = "";
        let shapeFrame = "";
        let lineMissing = "";
        let linesFrame = "";
        try {
            k.drawRect({ width: 4, height: 4, texture: "missing" });
        } catch (error) {
            shapeMissing = String(error);
        }
        try {
            k.drawRect({ width: 4, height: 4, texture: "red", frame: 9 });
        } catch (error) {
            shapeFrame = String(error);
        }
        try {
            k.drawLine({
                p1: k.vec2(0),
                p2: k.vec2(4, 0),
                texture: "missing",
            });
        } catch (error) {
            lineMissing = String(error);
        }
        try {
            k.drawLines({
                pts: [k.vec2(0), k.vec2(4, 0), k.vec2(4)],
                texture: "red",
                frame: 9,
            });
        } catch (error) {
            linesFrame = String(error);
        }
        return { pixels, shapeMissing, shapeFrame, lineMissing, linesFrame };
    });

    result.pixels.slice(0, 3).forEach(pixel => {
        expectPixel(pixel, [255, 0, 0, 255]);
    });
    expectPixel(result.pixels[3], [0, 255, 0, 255]);
    expectPixel(result.pixels[4], [255, 0, 255, 255]);
    expect(result.shapeMissing).not.toBe("");
    expect(result.shapeMissing.toLowerCase()).toContain("sprite");
    expect(result.shapeFrame).not.toBe("");
    expect(result.shapeFrame.toLowerCase()).toContain("frame");
    expect(result.lineMissing).not.toBe("");
    expect(result.lineMissing.toLowerCase()).toContain("sprite");
    expect(result.linesFrame).not.toBe("");
    expect(result.linesFrame.toLowerCase()).toContain("frame");
});

test("restores shape transforms after caught texture errors", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay({
            global: false,
            width: 128,
            height: 64,
            pixelDensity: 1,
            background: [0, 0, 0],
            debug: false,
        });
        const source = document.createElement("canvas");
        source.width = 1;
        source.height = 1;
        source.getContext("2d")!.fillStyle = "white";
        source.getContext("2d")!.fillRect(0, 0, 1, 1);
        await k.loadSprite("error-transform", source, {
            singular: true,
            filter: "nearest",
        });

        let missingCaught = false;
        let frameCaught = false;
        k.onDraw(() => {
            missingCaught = false;
            frameCaught = false;
            try {
                k.drawRect({
                    pos: k.vec2(80, 8),
                    width: 12,
                    height: 12,
                    texture: "missing-transform",
                });
            } catch {
                missingCaught = true;
            }
            try {
                k.drawCircle({
                    pos: k.vec2(0, 40),
                    radius: 6,
                    outline: {
                        width: 2,
                        texture: "error-transform",
                        frame: 9,
                    },
                });
            } catch {
                frameCaught = true;
            }
            k.drawRect({
                pos: k.vec2(8, 8),
                width: 16,
                height: 16,
                color: k.RED,
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
        output.height = 64;
        const outputContext = output.getContext("2d")!;
        outputContext.drawImage(image, 0, 0);
        return {
            missingCaught,
            frameCaught,
            control: Array.from(
                outputContext.getImageData(16, 16, 1, 1).data,
            ),
        };
    });

    expect(result.missingCaught).toBe(true);
    expect(result.frameCaught).toBe(true);
    expectPixel(result.control, [255, 0, 0, 255]);
});
