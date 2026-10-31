import { ASCII_CHARS } from "../constants/general";
import type { Frame } from "../gfx/TexPacker";
import { _k } from "../shared";
import type { TexFilter } from "../types";
import { runes } from "../utils/runes";
import { type Asset, loadImg } from "./asset";
import { makeFont } from "./font";
import { fixURL } from "./utils";

/**
 * @group Assets
 * @subgroup Types
 */
export interface GfxFont {
    map: Record<string, Frame>;
    size: number;
    filter: TexFilter;
    glyphLabels?: string[];
    ligatures?: string[];
}

/**
 * @group Assets
 * @subgroup Data
 */
export type BitmapFontData = GfxFont;

export function getBitmapFont(name: string): Asset<BitmapFontData> | null {
    return _k.assets.bitmapFonts.get(name) ?? null;
}

/**
 * @group Assets
 * @subgroup Types
 */
export interface LoadBitmapFontOpt {
    /**
     * Characters or glyph labels to map to every sprite in the characters grid
     *
     * @default " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
     */
    chars?: string | string[];
    /**
     * Rasterization filter to use, if different than the global font filter.
     */
    filter?: TexFilter;
}

// TODO: support LoadSpriteSrc
export function loadBitmapFont(
    name: string | null,
    src: string,
    gw: number,
    gh: number,
    opt: LoadBitmapFontOpt = {},
): Asset<BitmapFontData> {
    const fontSrc = fixURL(src);
    const chars = Array.isArray(opt.chars)
        ? opt.chars.slice()
        : opt.chars ?? ASCII_CHARS;
    const filter = opt.filter ?? _k.globalOpt.fontFilter ?? "nearest";

    return _k.assets.bitmapFonts.add(
        name,
        loadImg(fontSrc)
            .then((img) => {
                return makeFont(
                    img,
                    gw,
                    gh,
                    chars,
                    filter,
                );
            }),
    );
}

export function loadBitmapFontFromSprite(
    spriteID: string,
    chars: string | string[],
): Asset<BitmapFontData> {
    return _k.assets.bitmapFonts.add(
        spriteID,
        (async () => {
            const glyphs = Array.isArray(chars)
                ? chars.slice()
                : chars.split("");
            if (
                Array.isArray(chars)
                    ? chars.some(ch => ch.includes("\n"))
                    : /[\n ]/.test(chars)
            ) {
                throw new Error(
                    `While defining sprite font "${spriteID}": ${
                        Array.isArray(chars) ? "newlines" : "spaces"
                    } are not allowed in chars`,
                );
            }
            if (new Set(glyphs).size !== glyphs.length) {
                throw new Error(
                    `Duplicate characters given when defining sprite font "${spriteID}": ${chars}`,
                );
            }
            const spr = await _k.assets.sprites.waitFor(
                spriteID,
                _k.globalOpt.loadTimeout ?? 3000,
            );
            const frames = spr.frames;
            if (frames.length < glyphs.length) {
                throw new Error(
                    `Tried to define ${glyphs.length} characters for sprite font "${spriteID}", but there are only ${frames.length} frames defined`,
                );
            }
            const h = spr.height;
            return {
                map: Object.fromEntries(
                    glyphs.map((c, i) => [c, frames[i]]),
                ),
                size: h,
                filter: null as any,
                glyphLabels: Array.isArray(chars) ? glyphs : undefined,
                ligatures: Array.isArray(chars)
                    ? glyphs.filter(ch => runes(ch).length > 1)
                    : [],
            };
        })(),
    );
}

// loading happiness...
export function loadHappy(
    fontName: string = "happy",
    opt?: LoadBitmapFontOpt,
) {
    if (!_k.game.defaultAssets.happy) {
        throw new Error("You can't use loadHappy with kaplay/mini");
    }

    return loadBitmapFont(fontName, _k.game.defaultAssets.happy, 28, 36, {
        filter: "nearest",
        ...opt,
    });
}
