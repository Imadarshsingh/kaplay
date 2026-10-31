import type { Asset } from "../src/assets/asset";
import type { SpriteData } from "../src/assets/sprite";
import type { KAPLAYCtx } from "../src/core/contextType";

declare const k: KAPLAYCtx;
declare const asset: Asset<SpriteData>;
declare const data: SpriteData;

k.drawRect({ width: 10, height: 10, texture: "tiles", frame: 1 });
k.drawRect({ width: 10, height: 10, texture: data });
k.drawRect({ width: 10, height: 10, texture: asset });
k.drawCircle({ radius: 10, texture: "tiles" });
k.drawCircle({ radius: 10, texture: data });
k.drawCircle({ radius: 10, texture: asset });
k.drawEllipse({ radiusX: 10, radiusY: 5, texture: "tiles" });
k.drawEllipse({ radiusX: 10, radiusY: 5, texture: data });
k.drawEllipse({ radiusX: 10, radiusY: 5, texture: asset });
k.drawPolygon({ pts: [k.vec2(0), k.vec2(1), k.vec2(0, 1)], texture: "tiles" });
k.drawPolygon({ pts: [k.vec2(0), k.vec2(1), k.vec2(0, 1)], texture: data });
k.drawPolygon({ pts: [k.vec2(0), k.vec2(1), k.vec2(0, 1)], texture: asset });
k.drawLine({ p1: k.vec2(0), p2: k.vec2(1), texture: "tiles" });
k.drawLine({ p1: k.vec2(0), p2: k.vec2(1), texture: data });
k.drawLine({ p1: k.vec2(0), p2: k.vec2(1), texture: asset, frame: 2 });
k.drawLine({
    p1: k.vec2(0),
    p2: k.vec2(1),
    texture: "tiles",
    textureMapping: "path",
});
k.drawLines({ pts: [k.vec2(0), k.vec2(1)], texture: "tiles" });
k.drawLines({ pts: [k.vec2(0), k.vec2(1)], texture: data });
k.drawLines({ pts: [k.vec2(0), k.vec2(1)], texture: asset });
k.drawRect({
    width: 10,
    height: 10,
    outline: {
        width: 2,
        texture: "border",
        frame: 3,
        textureMapping: "path",
    },
});

const rect = k.rect(10, 10, { texture: "tiles", frame: 1 });
const circle = k.circle(10, { texture: data });
const ellipse = k.ellipse(10, 5, { texture: asset, frame: 2 });
const polygon = k.polygon(
    [k.vec2(0), k.vec2(1), k.vec2(0, 1)],
    { texture: "tiles" },
);
rect.texture = asset;
circle.frame = 1;
ellipse.texture = "other";
polygon.frame = 2;
const rectTexture = rect.texture;
const circleTexture = circle.texture;
const rectFrame: number = rect.frame;
const circleFrame: number = circle.frame;
const ellipseFrame: number = ellipse.frame;
const polygonFrame: number = polygon.frame;
const polygonTexture = polygon.texture;

const outlined = k.outline(2, k.WHITE, 1, "round", 10, "square", {
    texture: "border",
    frame: 1,
    textureMapping: "path",
});
outlined.outline.texture = asset;
outlined.outline.frame = 2;
const outlineTexture = outlined.outline.texture;
const outlineFrame = outlined.outline.frame;
const outlineTextureMapping = outlined.outline.textureMapping;

void [
    rectTexture,
    circleTexture,
    rectFrame,
    circleFrame,
    ellipseFrame,
    polygonFrame,
    polygonTexture,
    outlineTexture,
    outlineFrame,
    outlineTextureMapping,
];
