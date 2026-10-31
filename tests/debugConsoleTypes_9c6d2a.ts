import type { Debug } from "../src/debug/debug";

declare const debug: Debug;

debug.registerCommand(
    "teleport",
    "move the player",
    { x: "horizontal position", y: "vertical position" },
    async (x, y) => {
        const pair: string = `${x},${y}`;
        await Promise.resolve(pair);
    },
);
