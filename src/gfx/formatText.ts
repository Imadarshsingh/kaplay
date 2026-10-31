import { Asset } from "../assets/asset";
import type { BitmapFontData, GfxFont } from "../assets/bitmapFont";
import { FontData, resolveFont } from "../assets/font";
import { DEF_TEXT_CACHE_SIZE } from "../constants/general";
import { Color, rgb } from "../math/color";
import { vec2 } from "../math/math";
import { _k } from "../shared";
import type { Outline } from "../types";
import { runes } from "../utils/runes";
import { alignPt } from "./anchor";
import type { FormattedChar, FormattedText } from "./draw/drawFormattedText";
import type { CharTransform, DrawTextOpt } from "./draw/drawText";
import { getFontLigatureMatcher } from "./fontLigatures";
import type { Frame } from "./TexPacker";

/**
 * @group Rendering
 * @subgroup Text
 */
export type FontAtlas = {
    font: BitmapFontData;
    maxHeight: number;
    outline: Outline | null;
    ascent: number;
    descent: number;
    lineHeight: number;
};

/**
 * @group Rendering
 * @subgroup Text
 */
export type StyledTextInfo = {
    charStyleMap: Record<number, [string, string][]>;
    text: string;
};

type CompiledStyledTextInfo = StyledTextInfo & {
    charStyleRunMap: number[];
};

const ligatureChars = new WeakSet<FormattedChar>();

function applyCharTransform(fchar: FormattedChar, tr: CharTransform) {
    if (tr.font) fchar.font = tr.font;
    if (tr.stretchInPlace !== undefined) {
        fchar.stretchInPlace = tr.stretchInPlace;
    }
    if (tr.shader !== undefined) fchar.shader = tr.shader;
    if (tr.uniform !== undefined) fchar.uniform = tr.uniform;
    if (typeof tr.skew === "number") tr.skew = vec2(-tr.skew, 0);
    if (tr.override) {
        Object.assign(fchar, tr);
        return;
    }
    if (tr.pos) fchar.pos = fchar.pos.add(tr.pos);
    if (tr.scale) fchar.scale = fchar.scale.scale(vec2(tr.scale));
    if (tr.skew) fchar.skew = fchar.skew.add(vec2(tr.skew));
    if (tr.angle) fchar.angle += tr.angle;
    if (tr.color && (fchar.ch.length === 1 || ligatureChars.has(fchar))) {
        fchar.color = fchar.color.mult(tr.color);
    }
    // attention to type coercion, 0 is a valid value, only null & undefined are not
    if (tr.opacity != null) fchar.opacity *= tr.opacity;
}

function compileStyledTextInternal(txt: any): CompiledStyledTextInfo {
    const charStyleMap = {} as Record<number, [string, string][]>;
    const charStyleRunMap: number[] = [];
    let renderText = "";
    let styleStack: [string, string][] = [];
    let styleRun = 0;
    let text = String(txt);

    const emit = (ch: string) => {
        charStyleRunMap[renderText.length] = styleRun;
        if (styleStack.length > 0) {
            charStyleMap[renderText.length] = styleStack.slice();
        }
        renderText += ch;
    };

    while (text !== "") {
        if (text[0] === "\\") {
            if (text.length === 1) {
                throw new Error("Styled text error: \\ at end of string");
            }
            emit(text[1]);
            text = text.slice(2);
            continue;
        }
        if (text[0] === "[") {
            const execResult = /^\[(\/)?(\w+?)(?:=(.+?))?\]/.exec(text);
            if (!execResult) {
                // xxx: should throw an error here?
                emit(text[0]);
                text = text.slice(1);
                continue;
            }
            const [m, endSlash, theTagName, tagParam] = execResult;
            if (endSlash !== undefined) {
                if (tagParam) {
                    throw new Error(
                        `Styled text error: cannot use param in close tag [/${theTagName}]`,
                    );
                }
                if (styleStack.length === 0) {
                    throw new Error(
                        `Styled text error: stray end tag [/${theTagName}]`,
                    );
                }
                const [expectedTagName, arg] = styleStack.pop()!;
                if (expectedTagName !== theTagName) {
                    throw new Error(
                        `Styled text error: mismatched tags. Expected [/${expectedTagName}], got [/${theTagName}]`,
                    );
                }
            }
            else styleStack.push([theTagName, tagParam]);
            styleRun++;
            text = text.slice(m.length);
            continue;
        }
        emit(text[0]);
        text = text.slice(1);
    }

    if (styleStack.length > 0) {
        throw new Error(
            `Styled text error: unclosed tags ${styleStack.join(", ")}`,
        );
    }

    return {
        charStyleMap,
        charStyleRunMap,
        text: renderText,
    };
}

export function compileStyledText(txt: any): StyledTextInfo {
    const { charStyleMap, text } = compileStyledTextInternal(txt);
    return { charStyleMap, text };
}

function applyTransform(
    transform: DrawTextOpt["transform"],
    fchar: FormattedChar,
) {
    if (!transform) return;

    const tr = typeof transform === "function"
        ? transform(fchar.textCursor, fchar.ch, "")
        : transform;
    if (tr) applyCharTransform(fchar, tr);
}

function applyStyles(
    stylesOpt: DrawTextOpt["styles"],
    fchar: FormattedChar,
) {
    for (const [name, param] of fchar.styles) {
        const style = stylesOpt?.[name];

        const tr = typeof style === "function"
            ? style(fchar.textCursor, fchar.ch, param)
            : style;

        if (tr) applyCharTransform(fchar, tr);
    }
}

export function transformFormattedText(
    formattedText: FormattedText,
    opt: DrawTextOpt,
    reformatOnStretch = false,
): FormattedText {
    const opacity = opt.opacity ?? 1;
    const color = opt.color ?? Color.WHITE;

    for (const fchar of formattedText.chars) {
        fchar.pos.set(fchar.initPos.x, fchar.initPos.y);
        fchar.opacity = opacity;
        fchar.color = color;
        fchar.scale.set(fchar.initScale.x, fchar.initScale.y);
        fchar.skew.set(0, 0);
        fchar.angle = 0;

        applyTransform(opt.transform, fchar);
        applyStyles(opt.styles, fchar);

        if (reformatOnStretch && !fchar.stretchInPlace) {
            return formatText(opt);
        }
    }

    return formattedText;
}

function getFontName(font: FontData | string): string {
    return font instanceof FontData
        ? font.fontface.family
        : font;
}

function getFontAtlasForFont(font: FontData | string): FontAtlas {
    const fontName = getFontName(font);
    let atlas = _k.gfx.fontAtlases[fontName];
    if (!atlas) {
        // create a new atlas
        const f = font instanceof FontData ? font : null;
        _k.gfx.fontAtlases[fontName] = atlas = {
            font: {
                map: {},
                size: f?.size ?? DEF_TEXT_CACHE_SIZE,
                filter: f?.filter ?? _k.globalOpt.fontFilter ?? "linear",
            },
            maxHeight: 0,
            ascent: 0,
            descent: 0,
            lineHeight: 0,
            outline: f?.outline ?? null,
        };
    }
    return atlas;
}

const allChars = (() => {
    const renderableChars: string[] = [];
    for (let i = 33; i <= 126; i++) { // ASCII printables, excluding space which is often ridiculously tall
        renderableChars.push(String.fromCharCode(i));
    }
    return renderableChars.join("") + "ÅÁÂÄÃĄ"; // extended support for tall accents
})();

function updateFontAtlas(font: FontData | string, ch: string) {
    const atlas = getFontAtlasForFont(font);
    const fontName = getFontName(font);
    if (!atlas.font.map[ch]) {
        const c2d = _k.fontCacheC2d;
        if (!c2d) {
            throw new Error(
                "error generating font texture: _k.fontCacheC2d is null",
            );
        }

        if (!_k.fontCacheCanvas) {
            throw new Error(
                "error generating font texture: _k.fontCacheCanvas is missing",
            );
        }

        c2d.clearRect(
            0,
            0,
            _k.fontCacheCanvas.width,
            _k.fontCacheCanvas.height,
        );

        c2d.font = `${atlas.font.size}px ${fontName}, sans-serif`; // generic-family fallback stabilizes ascent of missing glyphs
        c2d.textBaseline = "alphabetic"; // more accurate across browsers and easier to calculate baseline
        c2d.textAlign = "left";
        c2d.fillStyle = "#fff";

        if (!atlas.lineHeight) {
            const m = c2d.measureText(allChars);
            const ascent = m.actualBoundingBoxAscent;
            const descent = m.actualBoundingBoxDescent;
            const safeOffset = 2;

            atlas.ascent =
                Math.ceil(ascent > 0 ? ascent : atlas.font.size * 0.78)
                + safeOffset;
            atlas.descent =
                Math.ceil(descent > 0 ? descent : atlas.font.size * 0.22)
                + safeOffset;
            atlas.lineHeight = Math.ceil(atlas.ascent + atlas.descent);
        }

        let w = Math.ceil(c2d.measureText(ch).width);
        if (!w) return;

        let h = atlas.lineHeight;

        const p = (atlas.outline?.width ?? 0)
            * (_k.globalOpt.pixelDensity || 1);
        const x = p;
        const y = p + atlas.ascent;

        w += p * 2;
        h += p * 2;

        if (atlas.outline?.width) {
            c2d.lineJoin = "round";
            c2d.lineWidth = atlas.outline.width * 2;
            c2d.strokeStyle = rgb(atlas.outline?.color || 0).toHex();
            c2d.strokeText(ch, x, y);
        }

        c2d.fillText(ch, x, y);

        const img = c2d.getImageData(0, 0, w, h);

        atlas.font.map[ch] = _k.assets.packer.add(img, atlas.font.filter);
        _k.assets.packer.syncIfPending();

        atlas.maxHeight = Math.max(atlas.maxHeight, h);
    }
}

function getFontFrame(font: GfxFont, ch: string): Frame | undefined {
    const frame = font.map[ch];
    if (frame) {
        return frame;
    }

    const normalized = ch.normalize("NFD");
    const equivalent = font.glyphLabels?.find(label =>
        label.normalize("NFD") === normalized
    );
    return equivalent === undefined ? undefined : font.map[equivalent];
}

function getSourceSpans(
    text: string,
    chars: string[],
): { start: number; end: number }[] {
    const spans: { start: number; end: number }[] = [];
    let sourceCursor = 0;

    for (const ch of chars) {
        const start = sourceCursor;
        const normalized = ch.normalize("NFC");
        while (sourceCursor < text.length) {
            sourceCursor++;
            if (
                text.slice(start, sourceCursor).normalize("NFC") === normalized
            ) break;
        }
        spans.push({ start, end: sourceCursor });
    }

    return spans;
}

export function formatText(opt: DrawTextOpt): FormattedText {
    if (opt.text === undefined) {
        throw new Error("formatText() requires property \"text\".");
    }

    let font = resolveFont(opt.font);

    // if it's still loading
    if (!opt.text || opt.text === "" || font instanceof Asset || !font) {
        return {
            width: 0,
            height: 0,
            chars: [],
            opt: opt,
            renderedText: "",
        };
    }

    const { charStyleMap, charStyleRunMap, text } = compileStyledTextInternal(
        opt.text + "",
    );
    const chars = runes(text, opt.locale);
    const sourceSpans = getSourceSpans(text, chars);
    const charStyles = sourceSpans.map(span => charStyleMap[span.start] ?? []);
    const charStyleRuns = sourceSpans.map((span, index) => {
        const run = charStyleRunMap[span.start];
        for (let offset = span.start + 1; offset < span.end; offset++) {
            if (charStyleRunMap[offset] !== run) {
                return -(index + 1);
            }
        }
        return run;
    });

    const fontAtlas = font instanceof FontData || typeof font === "string"
        ? (() => {
            const atlas = getFontAtlasForFont(font);
            if (atlas.maxHeight == 0) updateFontAtlas(font, chars[0]);
            return atlas;
        })()
        : null;
    const defGfxFont = fontAtlas ? fontAtlas.font : font as GfxFont;
    const ligatures = font instanceof FontData
        ? font.ligatures
        : defGfxFont.ligatures;
    const ligatureMatcher = getFontLigatureMatcher(ligatures);

    const size = opt.size || defGfxFont.size;
    const sizeScale = size / defGfxFont.size;
    const scale = vec2(opt.scale ?? 1).scale(sizeScale);
    const lineSpacing = opt.lineSpacing ?? 0;
    const letterSpacing = opt.letterSpacing ?? 0;
    const baselineCenterOffset = fontAtlas
        ? Math.round((fontAtlas.maxHeight * sizeScale - size) / 2)
        : 0;

    let curX: number = 0;
    let tw = 0;
    const lines: Array<{
        width: number;
        chars: { ch: FormattedChar; font: GfxFont; sourceLength: number }[];
    }> = [];
    let curLine: typeof lines[number]["chars"] = [];
    let cursor = 0;
    let lastSpace: number | null = null;
    let lastSpaceWidth: number = 0;
    let paraIndentX: number | undefined = undefined;

    // TODO: word break
    while (cursor < chars.length) {
        const ligature = ligatureMatcher.match(
            chars,
            cursor,
            charStyleRuns,
            opt.locale,
        );
        const ch = ligature?.label ?? chars[cursor];
        const sourceLength = ligature?.sourceLength ?? 1;

        // always new line on '\n'
        if (ch === "\n") {
            lines.push({
                width: curX - letterSpacing,
                chars: curLine,
            });

            lastSpace = null;
            lastSpaceWidth = 0;
            curX = 0;
            curLine = [];
            paraIndentX = undefined;
        }
        else {
            const defaultFontValue =
                (font instanceof FontData || typeof font === "string")
                    ? font
                    : undefined;
            type PartialBy<T, K extends keyof T> =
                & Omit<T, K>
                & Partial<Pick<T, K>>;
            const theFChar: PartialBy<
                FormattedChar,
                "width" | "height" | "frame"
            > = {
                ch: ch,
                initPos: vec2(curX, 0),
                pos: vec2(curX, 0),
                opacity: opt.opacity ?? 1,
                color: opt.color ?? Color.WHITE,
                initScale: vec2(scale),
                scale: vec2(scale),
                skew: vec2(0),
                angle: 0,
                font: defaultFontValue,
                stretchInPlace: true,
                textCursor: cursor,
                styles: charStyles[cursor],
            };

            if (ligature) {
                ligatureChars.add(theFChar as FormattedChar);
            }

            applyTransform(opt.transform, theFChar as any);
            applyStyles(
                opt.styles,
                theFChar as any,
            );

            const requestedFont = theFChar.font;
            const resolvedFont = resolveFont(requestedFont);
            if (resolvedFont instanceof Asset || !resolvedFont) {
                // abort, not all fonts have loaded yet
                return {
                    width: 0,
                    height: 0,
                    chars: [],
                    opt: opt,
                    renderedText: "",
                };
            }
            let requestedFontData = defGfxFont;
            let requestedFontScale = 1;
            if (requestedFont && requestedFont !== defaultFontValue) {
                if (
                    resolvedFont instanceof FontData
                    || typeof resolvedFont === "string"
                ) {
                    requestedFontData = getFontAtlasForFont(requestedFont).font;
                }
                else requestedFontData = resolvedFont;
                requestedFontScale = defGfxFont.size / requestedFontData.size;
            }
            if (
                requestedFont
                && (resolvedFont instanceof FontData
                    || typeof resolvedFont === "string")
            ) updateFontAtlas(requestedFont, ch);

            let f = theFChar.frame = getFontFrame(requestedFontData, ch);

            // TODO: leave space if character not found?
            if (f) {
                let charWidth = f.q.w * f.tex.width * requestedFontScale
                    * (theFChar.stretchInPlace
                        ? scale
                        : theFChar.scale).x;

                if (opt.width && curX + charWidth > opt.width && curX > 0) {
                    // new line on last word if width exceeds
                    if (lastSpace != null) {
                        cursor -= curLine.slice(lastSpace).reduce(
                            (length, entry) => length + entry.sourceLength,
                            0,
                        );
                        // omit trailing space
                        curLine = curLine.slice(0, lastSpace - 1);
                        curX = lastSpaceWidth;
                    }
                    lastSpace = null;
                    lastSpaceWidth = 0;

                    lines.push({
                        width: curX - letterSpacing,
                        chars: curLine,
                    });

                    curX = paraIndentX ?? 0;
                    curLine = [];
                    continue;
                }

                theFChar.width = f.q.w * f.tex.width * requestedFontScale;
                theFChar.height = f.q.h * f.tex.height * requestedFontScale;

                theFChar.pos = theFChar.pos.add(
                    charWidth * 0.5,
                    theFChar.height * theFChar.scale.y * 0.5,
                );

                // queue char to be drawn
                curLine.push({
                    ch: theFChar as FormattedChar,
                    font: requestedFontData,
                    sourceLength,
                });

                if (ch === " ") {
                    lastSpace = curLine.length;
                    lastSpaceWidth = curX;
                }
                if (
                    opt.indentAll
                    && paraIndentX === undefined
                    && /\S/.test(ch)
                ) {
                    paraIndentX = curX;
                }

                curX += charWidth;
                tw = Math.max(tw, curX);
                curX += letterSpacing;
            }
        }

        cursor += sourceLength;
    }

    lines.push({
        width: curX - letterSpacing,
        chars: curLine,
    });

    if (opt.width) {
        tw = opt.width;
    }

    const formattedChars: FormattedChar[] = [];

    let th = 0;

    for (let i = 0; i < lines.length; i++) {
        if (i > 0) th += lineSpacing;
        const ox = (tw - lines[i].width) * alignPt(opt.align ?? "left");
        let thisLineHeight = size;
        for (const { ch } of lines[i].chars) {
            ch.pos = ch.pos.add(ox, th - baselineCenterOffset);
            ch.initPos = ch.pos;
            formattedChars.push(ch);
            thisLineHeight = Math.max(
                thisLineHeight,
                size * (ch.stretchInPlace ? scale : ch.scale).y / scale.y,
            );
        }
        th += thisLineHeight;
    }

    return {
        width: tw,
        height: th,
        chars: formattedChars,
        opt,
        renderedText: text,
    };
}
