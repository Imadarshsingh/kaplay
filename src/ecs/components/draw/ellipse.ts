import { getRenderProps } from "../../../game/utils";
import { drawEllipse } from "../../../gfx/draw/drawEllipse";
import { Ellipse } from "../../../math/math";
import { Vec2 } from "../../../math/Vec2";
import type {
    Comp,
    GameObj,
    TextureProps,
    TextureSource,
} from "../../../types";
import { nextRenderAreaVersion } from "../physics/area";
import type { AnchorComp } from "../transform/anchor";
import type { FillComp } from "./fill";
import type { outline } from "./outline";

/**
 * The serialized {@link ellipse `ellipse()`} component.
 *
 * @group Components
 * @subgroup Component Serialization
 */
export interface SerializedEllipseComp {
    radiusX: number;
    radiusY: number;
    fill?: boolean;
    texture?: string;
    frame?: number;
}

/**
 * The {@link ellipse `ellipse()`} component.
 *
 * @group Components
 * @subgroup Component Types
 */
export interface EllipseComp extends Comp {
    draw: Comp["draw"];
    /** Semi-major axis of ellipse. */
    radiusX: number;
    /** Semi-minor axis of ellipse. */
    radiusY: number;
    /** The sprite used to texture the ellipse. */
    texture?: TextureSource;
    /** The sprite frame used to texture the ellipse. */
    frame: number;
    /**
     * Render area of the ellipse.
     */
    renderArea(): Ellipse;
    serialize(): SerializedEllipseComp;
}

/**
 * Options for the {@link ellipse `ellipse()``} component.
 *
 * @group Components
 * @subgroup Component Types
 */
export interface EllipseCompOpt extends TextureProps {
    /**
     * If fill is false, the ellipse is not filled (useful if you only want to render outline with
     * {@link outline `outline()`} component).
     */
    fill?: boolean;
}

export function ellipse(
    radiusX: number,
    radiusY: number,
    opt: EllipseCompOpt = {},
): EllipseComp & { _renderAreaVersion: number } {
    let _shape: Ellipse | undefined;
    let _radiusX = radiusX;
    let _radiusY = radiusY;
    return {
        id: "ellipse",
        get radiusX() {
            return _radiusX;
        },
        set radiusX(value: number) {
            if (_radiusX != value) {
                _radiusX = value;
                if (_shape) _shape.radiusX = value;
                this._renderAreaVersion = nextRenderAreaVersion();
            }
        },
        get radiusY() {
            return _radiusY;
        },
        set radiusY(value: number) {
            if (_radiusY != value) {
                _radiusY = value;
                if (_shape) _shape.radiusY = value;
                this._renderAreaVersion = nextRenderAreaVersion();
            }
        },
        texture: opt.texture,
        frame: opt.frame ?? 0,
        draw(this: GameObj<EllipseComp | FillComp>) {
            drawEllipse(Object.assign(getRenderProps(this), {
                radiusX: this.radiusX,
                radiusY: this.radiusY,
                fill: this.fill ?? opt.fill,
                texture: this.texture,
                frame: this.frame,
            }));
        },
        renderArea(
            this: GameObj<
                AnchorComp | EllipseComp | { _renderAreaVersion: number }
            >,
        ) {
            if (!_shape) {
                _shape = new Ellipse(
                    new Vec2(0),
                    _radiusX,
                    _radiusY,
                );
                this._renderAreaVersion = nextRenderAreaVersion();
            }
            return _shape;
        },
        _renderAreaVersion: 0,
        inspect() {
            return `radiusX: ${Math.ceil(_radiusX)} radiusY: ${
                Math.ceil(_radiusY)
            }`;
        },
        serialize(this: GameObj<EllipseComp | FillComp>) {
            const data: SerializedEllipseComp = {
                radiusX: this.radiusX,
                radiusY: this.radiusY,
                fill: this.fill ?? opt.fill,
            };
            if (typeof this.texture === "string") {
                data.texture = this.texture;
                if (this.frame !== undefined) data.frame = this.frame;
            }
            return data;
        },
    };
}

export function ellipseFactory(data: SerializedEllipseComp) {
    const opt: EllipseCompOpt = {};

    if (data.fill) opt.fill = data.fill;
    if (data.texture) {
        opt.texture = data.texture;
        opt.frame = data.frame;
    }

    return ellipse(data.radiusX, data.radiusY, opt);
}
