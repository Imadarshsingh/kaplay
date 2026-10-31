import { resolveSprite, SpriteData } from "../../assets/sprite";
import type { Quad } from "../../math/math";
import type { Vec2 } from "../../math/Vec2";
import type { TextureSource } from "../../types";
import type { Texture } from "../gfx";

export interface ResolvedTexture {
    tex: Texture;
    quad: Quad;
}

export function resolveTexture(
    source: TextureSource,
    frameIndex: number = 0,
): ResolvedTexture | null {
    let data: SpriteData;

    if (source instanceof SpriteData) {
        data = source;
    }
    else {
        const asset = resolveSprite(source);
        if (!asset || !asset.data) {
            return null;
        }
        data = asset.data;
    }

    const frame = data.frames[frameIndex];
    if (!frame) {
        throw new Error(`Frame not found: ${frameIndex}`);
    }

    return {
        tex: frame.tex,
        quad: frame.q,
    };
}

export function mapTextureToBounds(pos: number[], quad: Quad): number[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < pos.length; i += 2) {
        minX = Math.min(minX, pos[i]);
        maxX = Math.max(maxX, pos[i]);
        minY = Math.min(minY, pos[i + 1]);
        maxY = Math.max(maxY, pos[i + 1]);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const uv = new Array<number>(pos.length);

    for (let i = 0; i < pos.length; i += 2) {
        const x = width === 0 ? 0.5 : (pos[i] - minX) / width;
        const y = height === 0 ? 0.5 : (pos[i + 1] - minY) / height;
        uv[i] = quad.x + x * quad.w;
        uv[i + 1] = quad.y + y * quad.h;
    }

    return uv;
}

export function mapTextureToPath(
    pos: number[],
    pts: Vec2[],
    width: number,
    bias: number,
    quad: Quad,
    closed: boolean,
): number[] {
    const segments: Array<{
        start: Vec2;
        dx: number;
        dy: number;
        length: number;
        lengthSquared: number;
        distance: number;
    }> = [];
    let totalLength = 0;

    for (let i = 1; i < pts.length; i++) {
        const start = pts[i - 1];
        const dx = pts[i].x - start.x;
        const dy = pts[i].y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) continue;
        const length = Math.sqrt(lengthSquared);
        segments.push({
            start,
            dx,
            dy,
            length,
            lengthSquared,
            distance: totalLength,
        });
        totalLength += length;
    }

    const uv = new Array<number>(pos.length);
    const centerOffset = width * 0.5 * bias;
    let segmentIndex = 0;

    const distanceToSegment = (
        segment: (typeof segments)[number],
        x: number,
        y: number,
    ) => {
        const px = x - segment.start.x;
        const py = y - segment.start.y;
        const projection = Math.max(
            0,
            Math.min(
                1,
                (px * segment.dx + py * segment.dy) / segment.lengthSquared,
            ),
        );
        const offsetX = x - segment.start.x - segment.dx * projection;
        const offsetY = y - segment.start.y - segment.dy * projection;
        return offsetX * offsetX + offsetY * offsetY;
    };

    for (let pairStart = 0; pairStart < pos.length; pairStart += 4) {
        const pairEnd = Math.min(pairStart + 4, pos.length);

        while (segmentIndex + 1 < segments.length) {
            let currentDistance = 0;
            let nextDistance = 0;
            for (let i = pairStart; i < pairEnd; i += 2) {
                currentDistance += distanceToSegment(
                    segments[segmentIndex],
                    pos[i],
                    pos[i + 1],
                );
                nextDistance += distanceToSegment(
                    segments[segmentIndex + 1],
                    pos[i],
                    pos[i + 1],
                );
            }

            if (nextDistance >= currentDistance) break;
            segmentIndex++;
        }

        for (let i = pairStart; i < pairEnd; i += 2) {
            let longitudinal = 0;
            let transverse = 0.5;
            const segment = segments[segmentIndex];

            if (segment) {
                const px = pos[i] - segment.start.x;
                const py = pos[i + 1] - segment.start.y;
                const projection = Math.max(
                    0,
                    Math.min(
                        1,
                        (px * segment.dx + py * segment.dy)
                            / segment.lengthSquared,
                    ),
                );
                const offsetX = pos[i] - segment.start.x
                    - segment.dx * projection;
                const offsetY = pos[i + 1] - segment.start.y
                    - segment.dy * projection;
                longitudinal = totalLength === 0
                    ? 0.5
                    : (segment.distance + segment.length * projection)
                        / totalLength;
                const signedDistance = (
                    offsetX * -segment.dy + offsetY * segment.dx
                ) / segment.length;
                transverse = width === 0
                    ? 0.5
                    : (signedDistance - centerOffset) / width + 0.5;
            }

            if (closed && i < 4) longitudinal = 0;
            if (closed && i >= pos.length - 4) longitudinal = 1;

            uv[i] = quad.x + longitudinal * quad.w;
            uv[i + 1] = quad.y
                + Math.max(0, Math.min(1, transverse)) * quad.h;
        }
    }

    return uv;
}
