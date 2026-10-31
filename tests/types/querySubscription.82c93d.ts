import type { KAPLAYCtx } from "../../src/core/contextType";
import type { GameObj, QueryOpt, QuerySubscription } from "../../src/types";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

declare const k: KAPLAYCtx;
declare const owner: GameObj;

const options: QueryOpt = {
    include: ["enemy", "active"],
    includeOp: "and",
    hierarchy: "descendants",
};

const contextSubscription = k.watchQuery<{ hp: number }>(options);
const objectSubscription: QuerySubscription<{ hp: number }> = owner.watchQuery<
    { hp: number }
>(options);
type ContextObjects = Expect<
    Equal<
        typeof contextSubscription.objects,
        readonly GameObj<{ hp: number }>[]
    >
>;
const contextObjectsAreTyped: ContextObjects = true;
const objects: readonly GameObj<{ hp: number }>[] = contextSubscription.objects;
const hp: number | undefined = objectSubscription.objects[0]?.hp;
const cancelled: boolean = contextSubscription.cancelled;

const addController = contextSubscription.onAdd(obj => {
    type AddPayload = Expect<Equal<typeof obj.hp, number>>;
    const id: number = obj.id;
    const hp: number = obj.hp;
    const payloadIsTyped: AddPayload = true;
    void id;
    void hp;
    void payloadIsTyped;
});
const removeController = contextSubscription.onRemove(obj => {
    type RemovePayload = Expect<Equal<typeof obj.hp, number>>;
    const id: number = obj.id;
    const hp: number = obj.hp;
    const payloadIsTyped: RemovePayload = true;
    void id;
    void hp;
    void payloadIsTyped;
});
const typedAddController = objectSubscription.onAdd(obj => {
    type AddPayload = Expect<Equal<typeof obj.hp, number>>;
    const hp: number = obj.hp;
    const payloadIsTyped: AddPayload = true;
    void payloadIsTyped;
    void hp;
});
const typedRemoveController = objectSubscription.onRemove(obj => {
    type RemovePayload = Expect<Equal<typeof obj.hp, number>>;
    const hp: number = obj.hp;
    const payloadIsTyped: RemovePayload = true;
    void payloadIsTyped;
    void hp;
});

addController.cancel();
removeController.cancel();
typedAddController.cancel();
typedRemoveController.cancel();
contextSubscription.cancel();

// @ts-expect-error the observable collection cannot be mutated by callers
contextSubscription.objects.push(owner);

void objects;
void contextObjectsAreTyped;
void hp;
void cancelled;
