import { expect, test } from "@playwright/test";

declare global {
    interface Window {
        commandTest?: Record<string, any>;
    }
}

test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: "dist/kaplay.js" });
});

async function openConsole(page: import("@playwright/test").Page) {
    await page.locator("canvas").focus();
    await page.keyboard.press("/");
}

async function submit(
    page: import("@playwright/test").Page,
    line: string,
) {
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
}

async function waitForBrowserFrames(
    page: import("@playwright/test").Page,
    count = 2,
) {
    await page.evaluate(frames =>
        new Promise<void>(resolve => {
            const next = () => {
                frames--;
                if (frames === 0) resolve();
                else requestAnimationFrame(next);
            };
            requestAnimationFrame(next);
        }), count);
}

async function screenshotPage(
    page: import("@playwright/test").Page,
) {
    return page.screenshot();
}

async function changedScreenshotPixels(
    page: import("@playwright/test").Page,
    first: Buffer,
    second: Buffer,
) {
    return page.evaluate(async ({ first, second }) => {
        const decode = async (source: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${source}`;
            await image.decode();
            return image;
        };
        const [firstImage, secondImage] = await Promise.all([
            decode(first),
            decode(second),
        ]);
        if (
            firstImage.width !== secondImage.width
            || firstImage.height !== secondImage.height
        ) return Number.POSITIVE_INFINITY;

        const canvas = document.createElement("canvas");
        canvas.width = firstImage.width;
        canvas.height = firstImage.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(firstImage, 0, 0);
        const firstPixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
        ).data;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(secondImage, 0, 0);
        const secondPixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
        ).data;

        let changed = 0;
        for (let i = 0; i < firstPixels.length; i += 4) {
            if (
                firstPixels[i] !== secondPixels[i]
                || firstPixels[i + 1] !== secondPixels[i + 1]
                || firstPixels[i + 2] !== secondPixels[i + 2]
                || firstPixels[i + 3] !== secondPixels[i + 3]
            ) changed++;
        }
        return changed;
    }, {
        first: first.toString("base64"),
        second: second.toString("base64"),
    });
}

async function screenshotStablePage(
    page: import("@playwright/test").Page,
) {
    let previous = await screenshotPage(page);
    for (let attempt = 0; attempt < 10; attempt++) {
        await waitForBrowserFrames(page, 2);
        const current = await screenshotPage(page);
        if (await changedScreenshotPixels(page, previous, current) === 0) {
            return current;
        }
        previous = current;
    }
    throw new Error("canvas did not reach a stable closed state");
}

test("registered commands receive quoted, escaped, and empty positional arguments", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false });
        window.commandTest = { calls: [] };
        k.debug.registerCommand(
            "capture",
            "captures arguments",
            {
                plain: "plain value",
                double: "double quoted value",
                single: "single quoted value",
                escapedSpace: "escaped whitespace",
                escapedQuote: "escaped quote",
                escapedBackslash: "escaped backslash",
                escapedInQuote: "escaped content inside quotes",
                emptyDouble: "empty double-quoted value",
                emptySingle: "empty single-quoted value",
            },
            (...args) => window.commandTest!.calls.push(args),
        );
        k.debug.inspect = true;
    });

    await openConsole(page);
    const line = String
        .raw`   capture   plain   "two words"   'three words'   escaped\ value   \"quoted\"   back\\slash   "inside \"quote\" and \\ slash"   ""   ''   `;
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");

    await expect.poll(() => page.evaluate(() => window.commandTest!.calls))
        .toEqual([[
            "plain",
            "two words",
            "three words",
            "escaped value",
            "\"quoted\"",
            "back\\slash",
            "inside \"quote\" and \\ slash",
            "",
            "",
        ]]);
});

test("registration ignores or rejects invalid and duplicate names without replacing commands", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false });
        let calls = 0;
        let helpReplacementCalls = 0;
        let prototypeNameCalls = 0;
        const messages: string[] = [];
        const log = k.debug.log;
        k.debug.log = (...message) => {
            messages.push(message.map(String).join(" "));
            log(...message);
        };
        k.debug.registerCommand("custom", "original", {}, () => calls++);

        for (
            const [name, description] of [
                ["", "invalid empty description"],
                ["two words", "invalid space description"],
                ["two\twords", "invalid tab description"],
                ["custom", "replacement custom description"],
            ]
        ) {
            try {
                k.debug.registerCommand(name, description, {}, () => {
                    calls += 100;
                });
            } catch {}
        }
        try {
            k.debug.registerCommand(
                "help",
                "replacement help description",
                {},
                () => helpReplacementCalls++,
            );
        } catch {}

        k.debug.registerCommand("toString", "prototype-like name", {}, () => {
            prototypeNameCalls++;
        });

        window.commandTest = {
            k,
            get calls() {
                return calls;
            },
            get prototypeNameCalls() {
                return prototypeNameCalls;
            },
            get helpReplacementCalls() {
                return helpReplacementCalls;
            },
            messages,
        };
        k.debug.inspect = true;
    });

    await openConsole(page);
    await submit(page, "custom");
    await expect.poll(() => page.evaluate(() => window.commandTest!.calls))
        .toBe(1);
    await submit(page, "toString");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.prototypeNameCalls)
    ).toBe(1);
    await page.evaluate(() => {
        window.commandTest!.messages.length = 0;
    });
    await submit(page, "help");
    await expect.poll(() => page.evaluate(() => window.commandTest!.messages))
        .not.toHaveLength(0);
    const output = await page.evaluate(() =>
        window.commandTest!.messages.join("\n")
    );
    expect(await page.evaluate(() => window.commandTest!.calls)).toBe(1);
    expect(await page.evaluate(() => window.commandTest!.helpReplacementCalls))
        .toBe(0);
    expect(output).toContain("custom");
    expect(output).toContain("original");
    for (
        const rejected of [
            "invalid empty description",
            "invalid space description",
            "invalid tab description",
            "replacement custom description",
            "replacement help description",
        ]
    ) {
        expect(output).not.toContain(rejected);
    }
});

test("console lifecycle supports repeated submission and closes on Escape or inspect exit", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false });
        window.commandTest = { calls: 0, k, slashKeys: 0, slashChars: 0 };
        k.debug.registerCommand("ping", "increments", {}, () => {
            window.commandTest!.calls++;
        });
        k.onKeyPress("/", () => window.commandTest!.slashKeys++);
        k.onCharInput(character => {
            if (character === "/") window.commandTest!.slashChars++;
        });
    });

    await page.locator("canvas").focus();
    await page.keyboard.press("/");
    await expect.poll(() =>
        page.evaluate(() => ({
            keys: window.commandTest!.slashKeys,
            chars: window.commandTest!.slashChars,
        }))
    ).toEqual({ keys: 1, chars: 1 });
    await submit(page, "ping");
    expect(await page.evaluate(() => window.commandTest!.calls)).toBe(0);

    await page.evaluate(() => window.commandTest!.k.debug.inspect = true);
    await openConsole(page);
    await submit(page, "ping");
    await page.keyboard.press("ArrowRight");
    await submit(page, "ping");
    await expect.poll(() => page.evaluate(() => window.commandTest!.calls))
        .toBe(2);

    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.commandTest!.k.debug.inspect))
        .toBe(true);
    await submit(page, "ping");
    expect(await page.evaluate(() => window.commandTest!.calls)).toBe(2);

    await openConsole(page);
    await page.evaluate(() => window.commandTest!.k.debug.inspect = false);
    await submit(page, "ping");
    expect(await page.evaluate(() => window.commandTest!.calls)).toBe(2);

    await page.evaluate(() => window.commandTest!.k.debug.inspect = true);
    await openConsole(page);
    await submit(page, "ping");
    await expect.poll(() => page.evaluate(() => window.commandTest!.calls))
        .toBe(3);
});

test("commands and activation are isolated across engine lifetimes", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false });
        window.commandTest = { k, firstCalls: 0, secondCalls: 0 };
        k.debug.registerCommand("owned", "first owner", {}, () => {
            window.commandTest!.firstCalls++;
        });
        k.debug.inspect = true;
    });

    await openConsole(page);
    await submit(page, "owned");
    await expect.poll(() => page.evaluate(() => window.commandTest!.firstCalls))
        .toBe(1);
    await page.evaluate(() => window.commandTest!.k.quit());
    await expect(page.locator("canvas")).toHaveCount(0);

    await page.evaluate(() => {
        const k = kaplay({ global: false });
        window.commandTest!.k = k;
        k.debug.registerCommand("owned", "second owner", {}, () => {
            window.commandTest!.secondCalls++;
        });
        k.debug.inspect = true;
    });

    await page.evaluate(() => window.commandTest!.k.canvas.focus());
    await page.keyboard.press("/");
    await submit(page, "owned");
    await expect.poll(() =>
        page.evaluate(() => ({
            first: window.commandTest!.firstCalls,
            second: window.commandTest!.secondCalls,
        }))
    ).toEqual({ first: 1, second: 1 });

    await page.evaluate(() => window.commandTest!.k.quit());
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.evaluate(() => {
        const k = kaplay({ global: false, debug: false });
        window.commandTest!.k = k;
        k.debug.inspect = true;
    });
    await page.evaluate(() => window.commandTest!.k.canvas.focus());
    await page.keyboard.press("/");
    await submit(page, "owned");
    expect(
        await page.evaluate(() => ({
            first: window.commandTest!.firstCalls,
            second: window.commandTest!.secondCalls,
        })),
    ).toEqual({ first: 1, second: 1 });
});

test("the open console visibly renders the prompt and current input while paused", async ({ page }) => {
    test.setTimeout(90_000);
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            width: 320,
            height: 240,
            background: [255, 255, 255],
            logTime: 60,
        });
        window.commandTest = { k };
        k.debug.fps = () => 60;
        k.debug.rawFPS = () => 60;
        k.debug.paused = true;
    });

    const inspectOff = await screenshotStablePage(page);
    await page.evaluate(() => window.commandTest!.k.debug.inspect = true);
    const closed = await screenshotStablePage(page);
    await openConsole(page);
    await waitForBrowserFrames(page);
    const openBlank = await screenshotPage(page);
    await page.keyboard.type("visible marker");
    await waitForBrowserFrames(page);
    const openTyped = await screenshotPage(page);

    expect(await changedScreenshotPixels(page, closed, openBlank))
        .toBeGreaterThan(0);
    expect(await changedScreenshotPixels(page, openBlank, openTyped))
        .toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    const closedAgain = await screenshotStablePage(page);
    expect(await changedScreenshotPixels(page, closedAgain, openBlank))
        .toBeGreaterThan(0);

    await openConsole(page);
    await page.keyboard.type("second marker");
    await page.evaluate(() => window.commandTest!.k.debug.inspect = false);
    const inspectOffAgain = await screenshotStablePage(page);
    expect(await changedScreenshotPixels(page, inspectOff, inspectOffAgain))
        .toBe(0);
});

test("the prompt renders backslashes and formatting-like text without interrupting frames", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            width: 320,
            height: 240,
            background: [255, 255, 255],
        });
        let errors = 0;
        const error = k.debug.error;
        k.debug.error = (...message) => {
            errors++;
            error(...message);
        };
        window.commandTest = {
            k,
            get errors() {
                return errors;
            },
        };
        k.debug.fps = () => 60;
        k.debug.rawFPS = () => 60;
        k.onError(() => {});
        k.debug.inspect = true;
    });

    await openConsole(page);
    await waitForBrowserFrames(page);
    const blank = await screenshotPage(page);
    await page.keyboard.type("[red]");
    await waitForBrowserFrames(page, 3);
    const frameAfterTyping = await page.evaluate(() =>
        window.commandTest!.k.debug.numFrames()
    );
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.numFrames())
    ).toBeGreaterThan(frameAfterTyping);
    const bracketed = await screenshotStablePage(page);
    expect(await changedScreenshotPixels(page, blank, bracketed))
        .toBeGreaterThan(
            0,
        );

    await page.keyboard.press("Escape");
    await openConsole(page);
    await page.keyboard.type("red");
    const unbracketed = await screenshotStablePage(page);
    expect(
        await changedScreenshotPixels(page, bracketed, unbracketed),
    ).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await openConsole(page);
    await page.keyboard.type("one ");
    await waitForBrowserFrames(page, 2);
    const beforeTrailingBackslash = await screenshotPage(page);
    await page.keyboard.type("\\");
    await waitForBrowserFrames(page, 3);
    const afterTrailingBackslash = await screenshotPage(page);
    expect(
        await changedScreenshotPixels(
            page,
            beforeTrailingBackslash,
            afterTrailingBackslash,
        ),
    ).toBeGreaterThan(0);
    const frameAfterTrailingBackslash = await page.evaluate(() =>
        window.commandTest!.k.debug.numFrames()
    );
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.numFrames())
    ).toBeGreaterThan(frameAfterTrailingBackslash);

    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.commandTest!.errors))
        .toBeGreaterThan(0);
    const frameAfterMalformedSubmission = await page.evaluate(() =>
        window.commandTest!.k.debug.numFrames()
    );
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.numFrames())
    ).toBeGreaterThan(frameAfterMalformedSubmission);

    await page.keyboard.type("\\\\");
    await waitForBrowserFrames(page, 2);
    const beforeEscapedBracket = await screenshotPage(page);
    await page.keyboard.type("[red]");
    await waitForBrowserFrames(page, 3);
    const afterEscapedBracket = await screenshotPage(page);
    expect(
        await changedScreenshotPixels(
            page,
            beforeEscapedBracket,
            afterEscapedBracket,
        ),
    ).toBeGreaterThan(0);
    const frameAfterEscapedBracket = await page.evaluate(() =>
        window.commandTest!.k.debug.numFrames()
    );
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.numFrames())
    ).toBeGreaterThan(frameAfterEscapedBracket);
});

test("console input is isolated while open and resumes when closed", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            buttons: { action: { keyboard: "a" } },
        });
        window.commandTest = {
            k,
            commandCalls: 0,
            keyCalls: 0,
            charCalls: 0,
            buttonCalls: 0,
            escapeReleaseCalls: 0,
        };
        k.onKeyPress(() => window.commandTest!.keyCalls++);
        k.onKeyRelease("escape", () => {
            window.commandTest!.escapeReleaseCalls++;
        });
        k.onCharInput(() => window.commandTest!.charCalls++);
        k.onButtonPress("action", () => window.commandTest!.buttonCalls++);
        k.debug.registerCommand("a", "runs a", {}, () => {
            window.commandTest!.commandCalls++;
        });
        k.debug.inspect = true;
    });

    await openConsole(page);
    const baseline = await page.evaluate(() => ({
        keyCalls: window.commandTest!.keyCalls,
        charCalls: window.commandTest!.charCalls,
        buttonCalls: window.commandTest!.buttonCalls,
    }));
    await submit(page, "a");

    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.commandCalls)
    ).toBe(1);
    expect(
        await page.evaluate(() => ({
            keyCalls: window.commandTest!.keyCalls,
            charCalls: window.commandTest!.charCalls,
            buttonCalls: window.commandTest!.buttonCalls,
        })),
    ).toEqual(baseline);

    await page.keyboard.press("Escape");
    await waitForBrowserFrames(page);
    expect(
        await page.evaluate(() => window.commandTest!.escapeReleaseCalls),
    ).toBe(0);
    await page.keyboard.press("a");
    await expect.poll(() =>
        page.evaluate(() => ({
            keyCalls: window.commandTest!.keyCalls,
            charCalls: window.commandTest!.charCalls,
            buttonCalls: window.commandTest!.buttonCalls,
        }))
    ).toEqual({
        keyCalls: baseline.keyCalls + 1,
        charCalls: baseline.charCalls + 1,
        buttonCalls: baseline.buttonCalls + 1,
    });

    await openConsole(page);
    await page.evaluate(() => window.commandTest!.k.debug.inspect = false);
    await page.keyboard.press("a");
    await expect.poll(() =>
        page.evaluate(() => ({
            keyCalls: window.commandTest!.keyCalls,
            charCalls: window.commandTest!.charCalls,
            buttonCalls: window.commandTest!.buttonCalls,
        }))
    ).toEqual({
        keyCalls: baseline.keyCalls + 2,
        charCalls: baseline.charCalls + 2,
        buttonCalls: baseline.buttonCalls + 2,
    });
});

test("input held before opening is quiesced and cannot remain stuck", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            buttons: { action: { keyboardCode: "KeyA" } },
        });
        window.commandTest = {
            k,
            keyDownCalls: 0,
            keyReleaseCalls: 0,
            buttonDownCalls: 0,
            buttonReleaseCalls: 0,
        };
        k.onKeyDown("a", () => window.commandTest!.keyDownCalls++);
        k.onKeyRelease("a", () => window.commandTest!.keyReleaseCalls++);
        k.onButtonDown("action", () => {
            window.commandTest!.buttonDownCalls++;
        });
        k.onButtonRelease("action", () => {
            window.commandTest!.buttonReleaseCalls++;
        });
        k.debug.inspect = true;
    });

    await page.locator("canvas").focus();
    await page.keyboard.down("a");
    await expect.poll(() =>
        page.evaluate(() =>
            window.commandTest!.keyDownCalls > 0
            && window.commandTest!.buttonDownCalls > 0
        )
    ).toBe(true);

    const releasesBeforeOpen = await page.evaluate(() => ({
        key: window.commandTest!.keyReleaseCalls,
        button: window.commandTest!.buttonReleaseCalls,
    }));

    await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        canvas.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "a",
                code: "KeyA",
                bubbles: true,
            }),
        );
        canvas.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "a",
                code: "KeyA",
                bubbles: true,
            }),
        );
        canvas.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "a",
                code: "KeyA",
                bubbles: true,
            }),
        );
        canvas.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "/",
                code: "Slash",
                bubbles: true,
            }),
        );
    });
    await waitForBrowserFrames(page, 3);
    const captured = await page.evaluate(() => ({
        keyDown: window.commandTest!.keyDownCalls,
        keyRelease: window.commandTest!.keyReleaseCalls,
        buttonDown: window.commandTest!.buttonDownCalls,
        buttonRelease: window.commandTest!.buttonReleaseCalls,
    }));
    expect({
        key: captured.keyRelease,
        button: captured.buttonRelease,
    }).toEqual(releasesBeforeOpen);
    await waitForBrowserFrames(page, 3);
    expect(
        await page.evaluate(() => ({
            keyDown: window.commandTest!.keyDownCalls,
            keyRelease: window.commandTest!.keyReleaseCalls,
            buttonDown: window.commandTest!.buttonDownCalls,
            buttonRelease: window.commandTest!.buttonReleaseCalls,
        })),
    ).toEqual(captured);

    await page.keyboard.up("a");
    await waitForBrowserFrames(page, 2);
    expect(
        await page.evaluate(() => ({
            keyDown: window.commandTest!.keyDownCalls,
            keyRelease: window.commandTest!.keyReleaseCalls,
            buttonDown: window.commandTest!.buttonDownCalls,
            buttonRelease: window.commandTest!.buttonReleaseCalls,
        })),
    ).toEqual(captured);

    await page.keyboard.press("Escape");
    expect(
        await page.evaluate(() => ({
            key: window.commandTest!.k.isKeyDown("a"),
            button: window.commandTest!.k.isButtonDown("action"),
        })),
    ).toEqual({ key: false, button: false });

    await page.keyboard.down("a");
    await expect.poll(() =>
        page.evaluate(({ keyDown, buttonDown }) => ({
            key: window.commandTest!.k.isKeyDown("a"),
            button: window.commandTest!.k.isButtonDown("action"),
            keyDownAdvanced: window.commandTest!.keyDownCalls > keyDown,
            buttonDownAdvanced: window.commandTest!.buttonDownCalls
                > buttonDown,
        }), captured)
    ).toEqual({
        key: true,
        button: true,
        keyDownAdvanced: true,
        buttonDownAdvanced: true,
    });

    await page.keyboard.up("a");
    await expect.poll(() =>
        page.evaluate(() => ({
            key: window.commandTest!.k.isKeyDown("a"),
            button: window.commandTest!.k.isButtonDown("action"),
            keyRelease: window.commandTest!.keyReleaseCalls,
            buttonRelease: window.commandTest!.buttonReleaseCalls,
        }))
    ).toEqual({
        key: false,
        button: false,
        keyRelease: captured.keyRelease + 1,
        buttonRelease: captured.buttonRelease + 1,
    });
});

test("opening preserves a mouse-held logical button without release callbacks", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            buttons: {
                action: { keyboard: "a", mouse: "left" },
            },
        });
        k.debug.registerCommand("probe", "focus transfer probe", {}, () => {});
        window.commandTest = { k, buttonReleaseCalls: 0 };
        k.onButtonRelease("action", () => {
            window.commandTest!.buttonReleaseCalls++;
        });
        k.debug.inspect = true;
    });

    const canvas = page.locator("canvas");
    await canvas.focus();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2,
    );
    await page.mouse.down({ button: "left" });
    await expect.poll(() =>
        page.evaluate(() => ({
            mouse: window.commandTest!.k.isMouseDown("left"),
            action: window.commandTest!.k.isButtonDown("action"),
            releases: window.commandTest!.buttonReleaseCalls,
        }))
    ).toEqual({ mouse: true, action: true, releases: 0 });

    await page.keyboard.press("/");
    await waitForBrowserFrames(page, 3);
    expect(
        await page.evaluate(() => ({
            mouse: window.commandTest!.k.isMouseDown("left"),
            action: window.commandTest!.k.isButtonDown("action"),
            releases: window.commandTest!.buttonReleaseCalls,
        })),
    ).toEqual({ mouse: true, action: true, releases: 0 });

    await page.keyboard.press("Escape");
    await page.mouse.up({ button: "left" });
    await expect.poll(() =>
        page.evaluate(() => ({
            mouse: window.commandTest!.k.isMouseDown("left"),
            action: window.commandTest!.k.isButtonDown("action"),
            releases: window.commandTest!.buttonReleaseCalls,
        }))
    ).toEqual({ mouse: false, action: false, releases: 1 });
});

test("opening preserves a logical button still held by a gamepad", async ({ page }) => {
    await page.evaluate(() => {
        const south = { pressed: true, touched: true, value: 1 };
        const buttons = Array.from(
            { length: 18 },
            (_, index) =>
                index === 0
                    ? south
                    : { pressed: false, touched: false, value: 0 },
        );
        const gamepad = {
            id: "Standard Gamepad",
            index: 0,
            connected: true,
            mapping: "standard",
            timestamp: performance.now(),
            axes: [0, 0, 0, 0],
            buttons,
            vibrationActuator: null,
        } as unknown as Gamepad;
        Object.defineProperty(navigator, "getGamepads", {
            configurable: true,
            value: () => [gamepad],
        });

        const k = kaplay({
            global: false,
            buttons: {
                action: { keyboard: "a", gamepad: "south" },
            },
        });
        window.commandTest = { k, south };
        k.debug.inspect = true;
    });

    await expect.poll(() =>
        page.evaluate(() => ({
            gamepad: window.commandTest!.k.isGamepadButtonDown("south"),
            action: window.commandTest!.k.isButtonDown("action"),
        }))
    ).toEqual({ gamepad: true, action: true });

    await page.locator("canvas").focus();
    await page.keyboard.down("a");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.isButtonDown("action"))
    ).toBe(true);
    await page.keyboard.press("/");
    await waitForBrowserFrames(page, 2);
    expect(
        await page.evaluate(() => ({
            gamepad: window.commandTest!.k.isGamepadButtonDown("south"),
            action: window.commandTest!.k.isButtonDown("action"),
        })),
    ).toEqual({ gamepad: true, action: true });

    await page.keyboard.up("a");
    await waitForBrowserFrames(page, 2);
    expect(
        await page.evaluate(() => ({
            gamepad: window.commandTest!.k.isGamepadButtonDown("south"),
            action: window.commandTest!.k.isButtonDown("action"),
        })),
    ).toEqual({ gamepad: true, action: true });

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
        window.commandTest!.south.pressed = false;
        window.commandTest!.south.touched = false;
        window.commandTest!.south.value = 0;
    });
    await expect.poll(() =>
        page.evaluate(() => ({
            gamepad: window.commandTest!.k.isGamepadButtonDown("south"),
            action: window.commandTest!.k.isButtonDown("action"),
        }))
    ).toEqual({ gamepad: false, action: false });
});

test("opening discards pending keyboard input without synthesizing releases", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            buttons: { action: { keyboard: "a" } },
        });
        window.commandTest = {
            k,
            keyPressCalls: 0,
            keyDownCalls: 0,
            keyReleaseCalls: 0,
            charCalls: 0,
            buttonPressCalls: 0,
            buttonDownCalls: 0,
            buttonReleaseCalls: 0,
        };
        k.onKeyPress("a", () => window.commandTest!.keyPressCalls++);
        k.onKeyDown("a", () => window.commandTest!.keyDownCalls++);
        k.onKeyRelease("a", () => window.commandTest!.keyReleaseCalls++);
        k.onCharInput(() => window.commandTest!.charCalls++);
        k.onButtonPress("action", () => {
            window.commandTest!.buttonPressCalls++;
        });
        k.onButtonDown("action", () => {
            window.commandTest!.buttonDownCalls++;
        });
        k.onButtonRelease("action", () => {
            window.commandTest!.buttonReleaseCalls++;
        });
        k.debug.inspect = true;

        const canvas = document.querySelector("canvas")!;
        canvas.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "a",
                code: "KeyA",
                bubbles: true,
            }),
        );
        canvas.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "/",
                code: "Slash",
                bubbles: true,
            }),
        );
    });

    await waitForBrowserFrames(page, 3);
    expect(
        await page.evaluate(() => ({
            keyPress: window.commandTest!.keyPressCalls,
            keyDown: window.commandTest!.keyDownCalls,
            keyRelease: window.commandTest!.keyReleaseCalls,
            char: window.commandTest!.charCalls,
            buttonPress: window.commandTest!.buttonPressCalls,
            buttonDown: window.commandTest!.buttonDownCalls,
            buttonRelease: window.commandTest!.buttonReleaseCalls,
            keyHeld: window.commandTest!.k.isKeyDown("a"),
            buttonHeld: window.commandTest!.k.isButtonDown("action"),
        })),
    ).toEqual({
        keyPress: 0,
        keyDown: 0,
        keyRelease: 0,
        char: 0,
        buttonPress: 0,
        buttonDown: 0,
        buttonRelease: 0,
        keyHeld: false,
        buttonHeld: false,
    });

    await page.keyboard.press("Escape");
    await page.keyboard.down("a");
    await expect.poll(() =>
        page.evaluate(() => ({
            key: window.commandTest!.k.isKeyDown("a"),
            button: window.commandTest!.k.isButtonDown("action"),
            keyDownAdvanced: window.commandTest!.keyDownCalls > 0,
            buttonDownAdvanced: window.commandTest!.buttonDownCalls > 0,
        }))
    ).toEqual({
        key: true,
        button: true,
        keyDownAdvanced: true,
        buttonDownAdvanced: true,
    });

    await page.keyboard.up("a");
    await expect.poll(() =>
        page.evaluate(() => ({
            key: window.commandTest!.k.isKeyDown("a"),
            button: window.commandTest!.k.isButtonDown("action"),
            keyRelease: window.commandTest!.keyReleaseCalls,
            buttonRelease: window.commandTest!.buttonReleaseCalls,
        }))
    ).toEqual({
        key: false,
        button: false,
        keyRelease: 1,
        buttonRelease: 1,
    });
});

test("configured inspect aliases close the prompt without leaking key releases", async ({ page }) => {
    for (
        const config of [
            { debugKey: "left" as const, physicalKey: "ArrowLeft" },
            { debugKey: "space" as const, physicalKey: "Space" },
            { debugKey: "/" as const, physicalKey: "/" },
        ]
    ) {
        await page.goto("about:blank");
        await page.addScriptTag({ path: "dist/kaplay.js" });
        await page.evaluate((debugKey: "left" | "space" | "/") => {
            const k = kaplay({ global: false, debugKey });
            window.commandTest = { k, calls: 0, releaseCalls: 0 };
            k.onKeyRelease(debugKey, () => {
                window.commandTest!.releaseCalls++;
            });
            k.debug.registerCommand("ping", "increments", {}, () => {
                window.commandTest!.calls++;
            });
            k.debug.inspect = true;
        }, config.debugKey);

        await openConsole(page);
        await page.keyboard.type("ping");
        await page.keyboard.press(config.physicalKey);
        await expect.poll(() =>
            page.evaluate(() => window.commandTest!.k.debug.inspect)
        ).toBe(false);
        await waitForBrowserFrames(page);
        expect(
            await page.evaluate(() => window.commandTest!.releaseCalls),
        ).toBe(0);
        await page.keyboard.press("Enter");
        expect(await page.evaluate(() => window.commandTest!.calls)).toBe(0);
    }
});

test("invalid input and handler failures log errors and allow recovery", async ({ page }) => {
    for (
        const line of [
            "missing",
            `one "unterminated`,
            "one dangling\\",
            "one",
            "one first second",
            "throws",
            "rejects",
        ]
    ) {
        await page.goto("about:blank");
        await page.addScriptTag({ path: "dist/kaplay.js" });
        await page.evaluate(() => {
            const k = kaplay({
                global: false,
                width: 640,
                height: 480,
                background: [255, 255, 255],
                logTime: 60,
            });
            const errors: string[] = [];
            const error = k.debug.error;
            k.debug.error = (...message) => {
                errors.push(message.map(String).join(" "));
                error(...message);
            };
            window.commandTest = { k, valid: 0, invalid: 0, errors };
            k.debug.registerCommand(
                "one",
                "one argument",
                { value: "value" },
                () => {
                    window.commandTest!.invalid++;
                },
            );
            k.debug.registerCommand("throws", "throws", {}, () => {
                throw new Error("sync marker");
            });
            k.debug.registerCommand("rejects", "rejects", {}, async () => {
                throw new Error("async marker");
            });
            k.debug.registerCommand("valid", "recovers", {}, () => {
                window.commandTest!.valid++;
            });
            k.debug.inspect = true;
        });

        await openConsole(page);
        await submit(page, line);
        await expect.poll(() =>
            page.evaluate(() => window.commandTest!.errors.length)
        ).toBeGreaterThan(0);
        await submit(page, "valid");

        await expect.poll(() =>
            page.evaluate(() => ({
                valid: window.commandTest!.valid,
                invalid: window.commandTest!.invalid,
            }))
        ).toEqual({ valid: 1, invalid: 0 });
    }
});

test("help reports command metadata and clear uses the existing log clearing operation", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({
            global: false,
            width: 640,
            height: 480,
            background: [255, 255, 255],
            logMax: 4,
            logTime: 60,
        });
        let clearCalls = 0;
        const messages: string[] = [];
        const log = k.debug.log;
        k.debug.log = (...message) => {
            messages.push(message.map(String).join(" "));
            log(...message);
        };
        window.commandTest = {
            k,
            messages,
            get clearCalls() {
                return clearCalls;
            },
            set clearCalls(value: number) {
                clearCalls = value;
            },
        };
        k.debug.registerCommand(
            "warp",
            "move to a destination",
            { target: "destination name", speed: "travel speed" },
            () => {},
        );
        k.debug.inspect = true;
    });

    await openConsole(page);
    const initialTerms = [
        "help",
        "pause",
        "timescale",
        "clear",
        "screenshot",
        "warp",
        "move to a destination",
        "target",
        "destination name",
        "speed",
        "travel speed",
    ];
    await submit(page, "help");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.messages.length)
    ).toBeGreaterThan(0);
    const initialOutput = await page.evaluate(() =>
        window.commandTest!.messages.join("\n")
    );
    for (const term of initialTerms) {
        expect(initialOutput).toContain(term);
    }

    const messageCount = await page.evaluate(() => {
        window.commandTest!.k.debug.registerCommand(
            "late",
            "registered after help was used",
            { value: "late parameter" },
            () => {},
        );
        return window.commandTest!.messages.length;
    });
    const lateTerms = [
        "late",
        "registered after help was used",
        "value",
        "late parameter",
    ];
    await submit(page, "help");
    await expect.poll(() =>
        page.evaluate(
            count => window.commandTest!.messages.length > count,
            messageCount,
        )
    ).toBe(true);
    const updatedOutput = await page.evaluate(
        count => window.commandTest!.messages.slice(count).join("\n"),
        messageCount,
    );
    for (const term of lateTerms) {
        expect(updatedOutput).toContain(term);
    }

    await page.evaluate(() => {
        const k = window.commandTest!.k;
        const clearLog = k.debug.clearLog;
        k.debug.clearLog = () => {
            window.commandTest!.clearCalls++;
            clearLog();
        };
        window.commandTest!.k.debug.log("first retained log");
        window.commandTest!.k.debug.log("second retained log");
    });
    await submit(page, "clear");
    await expect.poll(() => page.evaluate(() => window.commandTest!.clearCalls))
        .toBe(1);
});

test("pause and timescale use existing debug state and work while paused", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false });
        let errors = 0;
        const error = k.debug.error;
        k.debug.error = (...message) => {
            errors++;
            error(...message);
        };
        window.commandTest = {
            k,
            ranWhilePaused: false,
            get errors() {
                return errors;
            },
        };
        k.debug.registerCommand("probe", "pause probe", {}, () => {
            window.commandTest!.ranWhilePaused = k.debug.paused;
        });
        k.debug.inspect = true;
    });

    await openConsole(page);
    await submit(page, "pause");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.paused)
    )
        .toBe(true);
    await submit(page, "probe");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.ranWhilePaused)
    ).toBe(true);
    await submit(page, "timescale 0");
    expect(await page.evaluate(() => window.commandTest!.k.debug.timeScale))
        .toBe(0);
    await submit(page, "timescale 1.25");
    expect(await page.evaluate(() => window.commandTest!.k.debug.timeScale))
        .toBe(1.25);

    for (const value of ["-1", "nope", "Infinity"]) {
        await submit(page, `timescale ${value}`);
        expect(await page.evaluate(() => window.commandTest!.k.debug.timeScale))
            .toBe(1.25);
    }

    for (const line of [`timescale ""`, `timescale "   "`]) {
        const errorsBefore = await page.evaluate(() =>
            window.commandTest!.errors
        );
        await submit(page, line);
        expect(await page.evaluate(() => window.commandTest!.k.debug.timeScale))
            .toBe(1.25);
        await expect.poll(() => page.evaluate(() => window.commandTest!.errors))
            .toBeGreaterThan(errorsBefore);
    }

    await submit(page, "pause");
    await expect.poll(() =>
        page.evaluate(() => window.commandTest!.k.debug.paused)
    )
        .toBe(false);
});

test("screenshot downloads the configured game canvas as PNG", async ({ page }) => {
    for (
        const config of [
            { width: 67, height: 43, background: [255, 0, 0] },
            { width: 89, height: 61, background: [0, 64, 255] },
        ]
    ) {
        await page.goto("about:blank");
        await page.addScriptTag({ path: "dist/kaplay.js" });
        await page.evaluate(({ width, height, background }) => {
            const decoy = document.createElement("canvas");
            decoy.width = 11;
            decoy.height = 13;
            document.body.appendChild(decoy);
            const k = kaplay({
                global: false,
                width,
                height,
                background,
            });
            const trailingDecoy = document.createElement("canvas");
            trailingDecoy.width = 17;
            trailingDecoy.height = 19;
            document.body.appendChild(trailingDecoy);
            window.commandTest = { k };
            k.debug.inspect = true;
        }, config);

        await expect.poll(() =>
            page.evaluate(() => window.commandTest!.k.debug.numFrames())
        ).toBeGreaterThan(0);
        await page.evaluate(() => window.commandTest!.k.canvas.focus());
        await page.keyboard.press("/");
        await page.keyboard.type("screenshot");
        await waitForBrowserFrames(page);
        const expectedPixels = await page.evaluate(async () => {
            const image = new Image();
            image.src = window.commandTest!.k.screenshot();
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return Array.from(
                context.getImageData(0, 0, image.width, image.height).data,
            );
        });
        const downloadPromise = page.waitForEvent("download", {
            timeout: 30000,
        });
        await page.keyboard.press("Enter");
        const download = await downloadPromise;

        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const png = Buffer.concat(chunks);
        expect(png.subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(png.readUInt32BE(16)).toBe(config.width);
        expect(png.readUInt32BE(20)).toBe(config.height);
        const capturedPixels = await page.evaluate(async (base64) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return Array.from(
                context.getImageData(0, 0, image.width, image.height).data,
            );
        }, png.toString("base64"));
        await waitForBrowserFrames(page);
        const submittedPixels = await page.evaluate(async () => {
            const image = new Image();
            image.src = window.commandTest!.k.screenshot();
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return Array.from(
                context.getImageData(0, 0, image.width, image.height).data,
            );
        });
        expect(capturedPixels).toHaveLength(config.width * config.height * 4);
        expect(
            Buffer.from(capturedPixels).equals(Buffer.from(expectedPixels))
                || Buffer.from(capturedPixels).equals(
                    Buffer.from(submittedPixels),
                ),
        ).toBe(true);
    }
});

test("debug false disables console activation", async ({ page }) => {
    await page.evaluate(() => {
        const k = kaplay({ global: false, debug: false });
        window.commandTest = { k, calls: 0, slashKeys: 0, slashChars: 0 };
        k.debug.registerCommand("ping", "increments", {}, () => {
            window.commandTest!.calls++;
        });
        k.onKeyPress("/", () => window.commandTest!.slashKeys++);
        k.onCharInput(character => {
            if (character === "/") window.commandTest!.slashChars++;
        });
        k.debug.inspect = true;
    });

    await page.locator("canvas").focus();
    const defaultPrevented = await page.evaluate(() => {
        const event = new KeyboardEvent("keydown", {
            key: "/",
            code: "Slash",
            bubbles: true,
            cancelable: true,
        });
        window.commandTest!.k.canvas.dispatchEvent(event);
        return event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
    await expect.poll(() =>
        page.evaluate(() => ({
            keys: window.commandTest!.slashKeys,
            chars: window.commandTest!.slashChars,
        }))
    ).toEqual({ keys: 1, chars: 1 });
    await submit(page, "ping");
    expect(await page.evaluate(() => window.commandTest!.calls)).toBe(0);
});
