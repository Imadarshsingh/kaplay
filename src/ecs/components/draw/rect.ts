import { getRenderProps } from "../../../game/utils";
import { drawRect } from "../../../gfx/draw/drawRect";
import { Rect, vec2 } from "../../../math/math";
import type {
    Comp,
    GameObj,
    TextureProps,
    TextureSource,
} from "../../../types";
import { nextRenderAreaVersion } from "../physics/area";
import type { FillComp } from "./fill";
/**
 * The serialized {@link rect `rect()`} component.
 *
 * @group Components
 * @subgroup Component Serialization
 */
export interface SerializedRectComp {
    width: number;
    height: number;
    radius?: number | [number, number, number, number];
    fill?: boolean;
    texture?: string;
    frame?: number;
}

/**
 * The {@link rect `rect()`} component.
 *
 * @group Components
 * @subgroup Component Types
 */
export interface RectComp extends Comp {
    draw: Comp["draw"];
    /**
     * Width of rectangle.
     */
    width: number;
    /**
     * Height of rectangle.
     */
    height: number;
    /**
     * The radius of each corner.
     */
    radius?: number | [number, number, number, number];
    /** The sprite used to texture the rectangle. */
    texture?: TextureSource;
    /** The sprite frame used to texture the rectangle. */
    frame: number;
    /**
     * @since v3000.0
     */
    renderArea(): Rect;
    serialize(): SerializedRectComp;
}

/**
 * Options for the {@link rect `rect()`} component.
 *
 * @group Components
 * @subgroup Component Types
 */
export interface RectCompOpt extends TextureProps {
    /**
     * Radius of the rectangle corners.
     */
    radius?: number | [number, number, number, number];
    /**
     * If fill the rectangle (useful if you only want to render outline with outline() component).
     */
    fill?: boolean;
}

export function rect(
    w: number,
    h: number,
    opt: RectCompOpt = {},
): RectComp & { _renderAreaVersion: number } {
    let _shape: Rect | undefined;
    let _width = w;
    let _height = h;
    return {
        id: "rect",
        get width() {
            return _width;
        },
        set width(value) {
            if (_width != value) {
                _width = value;
                if (_shape) _shape.width = value;
                this._renderAreaVersion = nextRenderAreaVersion();
            }
        },
        get height() {
            return _height;
        },
        set height(value) {
            if (_height != value) {
                _height = value;
                if (_shape) _shape.height = value;
                this._renderAreaVersion = nextRenderAreaVersion();
            }
        },
        radius: opt.radius || 0,
        texture: opt.texture,
        frame: opt.frame ?? 0,
        draw(this: GameObj<RectComp & FillComp>) {
            drawRect(Object.assign(getRenderProps(this), {
                width: _width,
                height: _height,
                radius: this.radius,
                fill: this.fill ?? opt.fill,
                texture: this.texture,
                frame: this.frame,
            }));
        },
        renderArea() {
            if (!_shape) {
                _shape = new Rect(vec2(0), _width, _height);
                this._renderAreaVersion = nextRenderAreaVersion();
            }
            return _shape;
        },
        _renderAreaVersion: 0,
        inspect() {
            return `rect: (${Math.ceil(_width)}w, ${Math.ceil(_height)}h)`;
        },
        serialize(this: GameObj<RectComp & FillComp>) {
            const data: SerializedRectComp = { width: _width, height: _height };
            if (this.radius) data.radius = this.radius;
            if (this.fill ?? opt.fill) data.fill = opt.fill;
            if (typeof this.texture === "string") {
                data.texture = this.texture;
                if (this.frame !== undefined) data.frame = this.frame;
            }
            return data;
        },
    };
}

export function rectFactory(data: SerializedRectComp) {
    const opt: RectCompOpt = {};
    if (data.radius) opt.radius = data.radius;
    if (data.fill) opt.fill = data.fill;
    if (data.texture) {
        opt.texture = data.texture;
        opt.frame = data.frame;
    }

    return rect(
        data.width,
        data.height,
        opt,
    );
}
