import { type App, normalizeKeyboardKey } from "../app/app";
import type { InternalAudioCtx } from "../audio/audio";
import { LOG_MAX } from "../constants/general";
import type { FrameRenderer } from "../core/frameRendering";
import type { Game } from "../game/game";
import type { AppGfxCtx } from "../gfx/gfxApp";
import { _k } from "../shared";
import type { KAPLAYOpt } from "../types";
import { download } from "../utils/dataURL";
import { parseCommandLine } from "./command";
import type { Recording } from "./record";

export type DebugCommandHandler = (
    ...args: string[]
) => unknown | Promise<unknown>;

type DebugCommand = {
    name: string;
    description: string;
    parameters: { name: string; description: string }[];
    handler: DebugCommandHandler;
};

/**
 * Available debugging message styles.
 *
 * @group Debug
 */
type DebugLogStyle = "info" | "warn" | "error";

/**
 * Acceptable values for debugging message.
 *
 * @group Debug
 */
type DebugMessage = string | { toString(): string } | Error;

/**
 * @group Debug
 */
export type DebugLog = {
    msg: DebugMessage;
    time: number;
    style: DebugLogStyle;
};

/**
 * An interface for debugging the game.
 *
 * @group Debug
 */
export interface Debug {
    /**
     * Pause the whole game.
     */
    paused: boolean;
    /**
     * Draw bounding boxes of all objects with `area()` component, hover to inspect their states.
     */
    inspect: boolean;
    /**
     * Global time scale.
     */
    timeScale: number;
    /**
     * Show the debug log or not.
     */
    showLog: boolean;
    /**
     * Current frames per second, that the game is running using
     * (may be limited by the `maxFPS` or `maxTimeStep` options)
     */
    fps(): number;
    /**
     * Raw frames per second from the browser unaffected by
     * the `maxFPS` or `maxTimeStep` options.
     */
    rawFPS(): number;
    /**
     * Total number of frames elapsed.
     *
     * @since v3000.0
     */
    numFrames(): number;
    /**
     * Number of draw calls made last frame.
     */
    drawCalls(): number;
    /**
     * Step to the next frame. Useful with pausing.
     */
    stepFrame(): void;
    /**
     * Clear the debug log.
     */
    clearLog(): void;
    /**
     * Log a message to the on-screen debug log, with optional
     * style wrapping.
     *
     * @param message - The messages to log
     * @param wrapStyle - Style to wrap all messages
     *
     * @example
     * ```
     * debug.logMessage(["oh", "hi"], "warn");
     * ```
     *
     * @since v4000.0
     */
    logMessage(message: DebugMessage[], wrapStyle?: DebugLogStyle): void;
    /**
     * Log a message with the info style (white) to the on-screen debug log.
     *
     * @param message - The message to log
     *
     * @example
     * ```
     * debug.log("oh", "hi")
     * ```
     */
    log(...message: DebugMessage[]): void;
    /**
     * Log a message with the warn style (yellow) to the on-screen debug log.
     *
     * @param message - The message to log
     *
     * @example
     * ```
     * debug.warn("oh", "humm")
     * ```
     *
     * @since v4000.0
     */
    warn(...message: DebugMessage[]): void;
    /**
     * Log a message with the error style (pink since kaboom) to the on-screen debug log.
     *
     * @param message - The message to log
     *
     * @example
     * ```
     * debug.error("oh", "no")
     * ```
     */
    error(...message: DebugMessage[]): void;
    /**
     * The recording handle if currently in recording mode.
     *
     * @since v2000.1
     */
    curRecording: Recording | null;
    /**
     * Get total number of objects.
     *
     * @since v3001.0
     */
    numObjects(): number;
    /**
     * Register a command for the debug console.
     *
     * @param name - Unique command name.
     * @param description - Description displayed by the help command.
     * @param parameters - Positional parameter names and descriptions.
     * @param handler - Function called with parsed string arguments.
     */
    registerCommand(
        name: string,
        description: string,
        parameters: Record<string, string>,
        handler: DebugCommandHandler,
    ): void;
}

export const createDebug = (
    gopt: KAPLAYOpt,
    app: App,
    appGfx: AppGfxCtx,
    audio: InternalAudioCtx,
    game: Game,
    fr: FrameRenderer,
    onCleanup: (action: () => void) => void,
): Debug & { readonly consoleOpen: boolean; readonly consoleInput: string } => {
    let debugPaused = false;
    let debugInspect = false;
    let consoleOpen = false;
    let consoleInput = "";
    let focusCanvasOnKeyup = false;
    const commands = new Map<string, DebugCommand>();
    const inputCaptureId = "debug-console";
    const commandInput = gopt.debug === false
        ? null
        : document.createElement("input");

    function closeConsole(restoreFocus = true) {
        if (!consoleOpen) return;
        consoleOpen = false;
        consoleInput = "";
        game.inputCapturedBy.delete(inputCaptureId);
        if (commandInput) {
            commandInput.value = "";
            if (restoreFocus) commandInput.blur();
        }
        if (restoreFocus) {
            app.setKeyboardInputCaptured(false);
            app.canvas.focus();
        }
    }

    function openConsole() {
        if (gopt.debug === false || !debugInspect || !commandInput) return;
        consoleOpen = true;
        consoleInput = "";
        commandInput.value = "";
        game.inputCapturedBy.add(inputCaptureId);
        app.setKeyboardInputCaptured(true);
        commandInput.focus({ preventScroll: true });
    }

    async function executeCommand(line: string) {
        let tokens: string[];
        try {
            tokens = parseCommandLine(line);
        } catch (error) {
            debug.error(error instanceof Error ? error : String(error));
            return;
        }

        if (tokens.length === 0) return;
        const [name, ...args] = tokens;
        const command = commands.get(name);
        if (!command) {
            debug.error(`Unknown command: ${name}`);
            return;
        }
        if (args.length !== command.parameters.length) {
            debug.error(
                `${name} expects ${command.parameters.length} argument(s), received ${args.length}`,
            );
            return;
        }

        try {
            await command.handler(...args);
        } catch (error) {
            debug.error(error instanceof Error ? error : String(error));
        }
    }

    function registerCommand(
        name: string,
        description: string,
        parameters: Record<string, string>,
        handler: DebugCommandHandler,
    ) {
        if (name.length === 0 || /\s/.test(name)) {
            throw new Error(
                "Command names must be non-empty and contain no whitespace",
            );
        }
        if (commands.has(name)) {
            throw new Error(`Command already registered: ${name}`);
        }

        commands.set(name, {
            name,
            description,
            parameters: Object.entries(parameters).map(
                ([parameterName, parameterDescription]) => ({
                    name: parameterName,
                    description: parameterDescription,
                }),
            ),
            handler,
        });
    }

    const debug = {
        get inspect() {
            return debugInspect;
        },
        set inspect(value: boolean) {
            debugInspect = value;
            if (!value) closeConsole();
        },
        get consoleOpen() {
            return consoleOpen;
        },
        get consoleInput() {
            return consoleInput;
        },
        set timeScale(timeScale: number) {
            app.state.timeScale = timeScale;
        },
        get timeScale() {
            return app.state.timeScale;
        },
        showLog: true,
        fps: () => app.fps(),
        rawFPS: () => app.rawFPS(),
        numFrames: () => app.numFrames(),
        stepFrame: fr.updateFrame,
        drawCalls: () => appGfx.lastDrawCalls,
        clearLog: () => game.logs = [],
        logMessage: (message, wrapStyle = "info") => {
            const max = gopt.logMax ?? LOG_MAX;
            const msg = message.length > 1
                ? message.concat(" ").join(" ")
                : message[0];

            game.logs.unshift({
                msg: msg,
                time: app.time(),
                style: wrapStyle,
            });

            if (game.logs.length > max) {
                game.logs = game.logs.slice(0, max);
            }
        },
        log: (...message) => {
            debug.logMessage(message, "info");
        },
        warn: (...message) => {
            debug.logMessage(message, "warn");
        },
        error: (...message) => {
            debug.logMessage(message, "error");
        },
        curRecording: null,
        numObjects: () => game.root.get("*", { recursive: true }).length,
        registerCommand,
        get paused() {
            return debugPaused;
        },
        set paused(v) {
            debugPaused = v;
            if (v) {
                audio.ctx.suspend();
            }
            else {
                audio.ctx.resume();
            }
        },
    } satisfies Debug & {
        readonly consoleOpen: boolean;
        readonly consoleInput: string;
    };

    registerCommand("help", "List available commands", {}, () => {
        const entries = [...commands.values()].map(command => {
            const parameters = command.parameters.map(parameter =>
                `${parameter.name}: ${parameter.description}`
            ).join(", ");
            return `${command.name}${
                parameters ? ` (${parameters})` : ""
            } - ${command.description}`;
        });
        debug.log(entries.join("\n"));
    });
    registerCommand("pause", "Toggle the game pause state", {}, () => {
        debug.paused = !debug.paused;
    });
    registerCommand(
        "timescale",
        "Set the game time scale",
        { value: "finite non-negative time scale" },
        (value) => {
            const timeScale = Number(value);
            if (
                value.trim() === "" || !Number.isFinite(timeScale)
                || timeScale < 0
            ) {
                throw new Error(
                    "Time scale must be a finite non-negative number",
                );
            }
            debug.timeScale = timeScale;
        },
    );
    registerCommand("clear", "Clear the debug log", {}, () => {
        debug.clearLog();
    });
    registerCommand("screenshot", "Download a screenshot", {}, () => {
        download("kaplay-screenshot.png", app.screenshot());
    });

    if (commandInput) {
        commandInput.type = "text";
        commandInput.autocomplete = "off";
        commandInput.tabIndex = -1;
        commandInput.setAttribute("aria-hidden", "true");
        commandInput.style.position = "fixed";
        commandInput.style.left = "-10000px";
        commandInput.addEventListener("input", () => {
            consoleInput = commandInput.value;
        });
        commandInput.addEventListener("blur", () => {
            if (consoleOpen) closeConsole();
        });
        commandInput.addEventListener("keydown", event => {
            event.stopPropagation();
            if (
                normalizeKeyboardKey(event.key) === (gopt.debugKey ?? "f1")
            ) {
                event.preventDefault();
                focusCanvasOnKeyup = true;
                closeConsole(false);
                debug.inspect = false;
            }
            else if (event.key === "Enter") {
                event.preventDefault();
                const line = commandInput.value;
                commandInput.value = "";
                consoleInput = "";
                void executeCommand(line);
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                focusCanvasOnKeyup = true;
                closeConsole(false);
            }
        });
        commandInput.addEventListener("keyup", event => {
            event.stopPropagation();
            if (!focusCanvasOnKeyup) return;
            event.preventDefault();
            focusCanvasOnKeyup = false;
            app.setKeyboardInputCaptured(false);
            commandInput.blur();
            app.canvas.focus();
        });
        document.body.appendChild(commandInput);

        app.setKeyboardCapture((_event, key) => {
            if (key !== "/" || !debugInspect) return false;
            openConsole();
            return true;
        });

        onCleanup(() => {
            closeConsole();
            app.setKeyboardInputCaptured(false);
            app.setKeyboardCapture(null);
            commandInput.remove();
        });
    }

    return debug;
};
