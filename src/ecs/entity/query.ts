import { KEvent, KEventController } from "../../events/events";
import { _k } from "../../shared";
import type {
    GameObj,
    GetOpt,
    QueryOpt,
    QuerySubscription,
    Tag,
} from "../../types";

type QueryLifetime = "context" | "object";
type QueryResolver<T> = () => readonly GameObj<T>[];

const subscriptionsByGame = new WeakMap<
    object,
    Set<QuerySubscriptionImpl<any>>
>();

function getSubscriptions() {
    const game = _k?.game;
    if (!game) return null;

    let subscriptions = subscriptionsByGame.get(game);
    if (!subscriptions) {
        subscriptions = new Set();
        subscriptionsByGame.set(game, subscriptions);
    }
    return subscriptions;
}

function uniqueObjects<T>(objects: readonly GameObj<T>[]) {
    const unique: GameObj<T>[] = [];
    const seen = new Set<GameObj<T>>();

    for (const obj of objects) {
        if (!seen.has(obj)) {
            seen.add(obj);
            unique.push(obj);
        }
    }

    return unique;
}

class QuerySubscriptionImpl<T> implements QuerySubscription<T> {
    readonly objects: GameObj<T>[];
    private readonly addEvents = new KEvent<[GameObj<T>]>();
    private readonly removeEvents = new KEvent<[GameObj<T>]>();
    private readonly subscriptions: Set<QuerySubscriptionImpl<any>> | null;
    private lifetimeController: KEventController | null = null;
    private refreshing = false;
    private refreshPending = false;
    private _cancelled = false;

    constructor(
        private readonly resolve: QueryResolver<T>,
        private readonly owner: GameObj,
        lifetime: QueryLifetime,
    ) {
        this.objects = uniqueObjects(resolve());
        this.subscriptions = getSubscriptions();
        this.subscriptions?.add(this);

        if (lifetime === "object") {
            this.lifetimeController = owner.onDestroy(() => this.cancel());
        }
        else {
            this.lifetimeController = _k.game.events.on(
                "sceneLeave",
                () => this.cancel(),
            );
        }
    }

    get cancelled() {
        return this._cancelled;
    }

    onAdd(action: (obj: GameObj<T>) => void) {
        if (this.cancelled) return new KEventController(() => {});
        return this.addEvents.add(action);
    }

    onRemove(action: (obj: GameObj<T>) => void) {
        if (this.cancelled) return new KEventController(() => {});
        return this.removeEvents.add(action);
    }

    cancel() {
        if (this.cancelled) return;

        this._cancelled = true;
        this.subscriptions?.delete(this);
        this.lifetimeController?.cancel();
        this.lifetimeController = null;
        this.addEvents.clear();
        this.removeEvents.clear();
    }

    isOwnedBy(owner: GameObj) {
        return this.owner === owner;
    }

    refresh() {
        if (this.cancelled) return;
        if (this.refreshing) {
            this.refreshPending = true;
            return;
        }

        this.refreshing = true;
        try {
            do {
                this.refreshPending = false;
                const next = uniqueObjects(this.resolve());
                const nextSet = new Set(next);

                for (let i = this.objects.length - 1; i >= 0; i--) {
                    const obj = this.objects[i];
                    if (!nextSet.has(obj)) {
                        this.objects.splice(i, 1);
                        this.removeEvents.trigger(obj);
                        if (this.cancelled) return;
                        if (this.refreshPending) break;
                    }
                }

                if (this.refreshPending) continue;

                const currentSet = new Set(this.objects);
                for (const obj of next) {
                    if (!currentSet.has(obj)) {
                        this.objects.push(obj);
                        this.addEvents.trigger(obj);
                        if (this.cancelled) return;
                        if (this.refreshPending) break;
                    }
                }
            } while (this.refreshPending && !this.cancelled);
        } finally {
            this.refreshing = false;
        }
    }
}

export function createLiveQuerySubscription<T>(
    owner: GameObj,
    resolve: QueryResolver<T>,
    lifetime: QueryLifetime,
) {
    return new QuerySubscriptionImpl(resolve, owner, lifetime);
}

/** Notify all live queries that a tree or filter value may have changed. */
export function notifyQuerySubscriptions() {
    const subscriptions = getSubscriptions();
    if (!subscriptions) return;

    [...subscriptions].forEach(subscription => subscription.refresh());
}

/** Refresh live queries after the engine has run object update callbacks. */
export function updateQuerySubscriptions() {
    notifyQuerySubscriptions();
}

/** Cancel subscriptions owned by an object subtree before that subtree is removed. */
export function cancelQuerySubscriptionsOwnedBy(owner: GameObj) {
    const subscriptions = getSubscriptions();
    if (!subscriptions) return;

    const owners = new Set<GameObj>();
    const collect = (obj: GameObj) => {
        owners.add(obj);
        obj.children.forEach(collect);
    };
    collect(owner);

    [...subscriptions].forEach(subscription => {
        if ([...owners].some(owner => subscription.isOwnedBy(owner))) {
            subscription.cancel();
        }
    });
}

function getDescendants(owner: GameObj) {
    return owner.children.flatMap(function recurse(child: GameObj): GameObj[] {
        return [child, ...child.children.flatMap(recurse)];
    });
}

function getObjectsForGet(
    owner: GameObj,
    tag: Tag | Tag[],
    opts: GetOpt,
) {
    const checkTagsOrComps = (child: GameObj) => {
        if (opts.only === "comps") return child.has(tag);
        if (opts.only === "tags") return child.is(tag);
        return child.is(tag) || child.has(tag);
    };

    const list = opts.recursive
        ? getDescendants(owner)
        : owner.children.slice();

    return list.filter(child => tag ? checkTagsOrComps(child) : true);
}

export function getObjects<T = any>(
    owner: GameObj,
    tag: Tag | Tag[],
    opts: GetOpt = {},
) {
    return getObjectsForGet(owner, tag, opts) as GameObj<T>[];
}

export function getObjectsWithLifetime<T = any>(
    owner: GameObj,
    tag: Tag | Tag[],
    opts: GetOpt = {},
    lifetime: QueryLifetime,
) {
    if (!opts.liveUpdate) return getObjects<T>(owner, tag, opts);

    const subscription = createLiveQuerySubscription(
        owner,
        () => getObjectsForGet(owner, tag, opts),
        lifetime,
    );
    return subscription.objects as GameObj<T>[];
}
