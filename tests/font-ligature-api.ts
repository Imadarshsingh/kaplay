import type { KAPLAYCtx, LoadFontOpt } from "../dist/doc";

declare const k: KAPLAYCtx;

const outlineOptions: LoadFontOpt = {
    ligatures: ["fi", "ffi"],
};

k.loadFont("outline", "font.ttf", outlineOptions);
k.loadBitmapFont("grid", "font.png", 8, 8, {
    chars: ["a", "->", "b"],
});
k.loadBitmapFontFromSprite("sprite", ["a", "->", "b"]);
