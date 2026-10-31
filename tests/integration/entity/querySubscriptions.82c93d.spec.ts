import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.addScriptTag({ path: "dist/kaplay.js" });
});

test("query subscriptions update one stable collection and report transitions", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const left = k.add([]);
        const item = left.add(["enemy"]);
        const subscription = left.watchQuery({
            include: "enemy",
            hierarchy: "descendants",
        });
        const objects = subscription.objects;
        const transitions: Array<[string, number, boolean]> = [];
        subscription.onAdd(obj => {
            transitions.push(["add", obj.id, objects.includes(obj)]);
        });
        subscription.onRemove(obj => {
            transitions.push(["remove", obj.id, !objects.includes(obj)]);
        });

        item.parent = null;
        const movedOut = objects.map(obj => obj.id);
        item.parent = left;
        item.untag("enemy");
        item.tag("enemy");
        const itemId = item.id;
        const beforeDestroy = objects.map(obj => obj.id);
        item.destroy();

        return {
            sameObjects: objects === subscription.objects,
            movedOut,
            beforeDestroy,
            afterDestroy: objects.map(obj => obj.id),
            transitions,
            item: itemId,
        };
    });

    expect(result).toEqual({
        sameObjects: true,
        movedOut: [],
        beforeDestroy: [result.item],
        afterDestroy: [],
        transitions: [
            ["remove", result.item, true],
            ["add", result.item, true],
            ["remove", result.item, true],
            ["add", result.item, true],
            ["remove", result.item, true],
        ],
        item: result.item,
    });
});

test("mutable query filters reconcile on the next update", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay();
        const anchor = k.add([k.pos(0, 0)]);
        const item = k.add([
            k.pos(20, 0),
            k.named("target"),
            { id: "visibility", visible: true },
            "candidate",
        ]);
        const blocker = k.add([
            k.pos(10, 0),
            k.named("target"),
            { id: "visibility", visible: true },
            "candidate",
            "blocked",
        ]);
        const near = anchor.watchQuery({
            include: "candidate",
            exclude: "blocked",
            hierarchy: "siblings",
            distance: 30,
            distanceOp: "near",
            visible: true,
            name: "target",
        });
        const far = anchor.watchQuery({
            include: "candidate",
            hierarchy: "siblings",
            distance: 30,
            distanceOp: "far",
        });
        const ids = (objects: readonly GameObj[]) => objects.map(obj => obj.id);
        const states = [{ near: ids(near.objects), far: ids(far.objects) }];

        item.pos.x = 50;
        await k.nextFrame();
        states.push({ near: ids(near.objects), far: ids(far.objects) });

        item.pos.x = 10;
        item.name = "other";
        await k.nextFrame();
        states.push({ near: ids(near.objects), far: ids(far.objects) });

        item.name = "target";
        item.visible = false;
        await k.nextFrame();
        states.push({ near: ids(near.objects), far: ids(far.objects) });

        item.visible = true;
        blocker.untag("blocked");
        await k.nextFrame();
        states.push({ near: ids(near.objects), far: ids(far.objects) });

        return { states, item: item.id, blocker: blocker.id };
    });

    expect(result.states.slice(0, 4)).toEqual([
        { near: [result.item], far: [] },
        { near: [], far: [result.item] },
        { near: [], far: [] },
        { near: [], far: [] },
    ]);
    const finalNear = result.states[4].near;
    expect(new Set(finalNear)).toEqual(new Set([result.item, result.blocker]));
    expect(finalNear).toHaveLength(2);
    expect(result.states[4].far).toEqual([]);
});

test("mutated query options reconcile on the next update", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay();
        const owner = k.add([]);
        const red = owner.add(["option-red"]);
        const blue = owner.add(["option-blue"]);
        const objectOptions = {
            include: "option-red",
            hierarchy: "children" as const,
        };
        const contextOptions = {
            include: "option-red",
            hierarchy: "descendants" as const,
        };
        const objectSubscription = owner.watchQuery(objectOptions);
        const contextSubscription = k.watchQuery(contextOptions);
        const objectTransitions: string[] = [];
        const contextTransitions: string[] = [];
        const record = (
            transitions: string[],
            kind: "add" | "remove",
            objects: readonly GameObj[],
            obj: GameObj,
        ) => {
            const reflected = kind === "add"
                ? objects.includes(obj)
                : !objects.includes(obj);
            transitions.push(`${kind}:${obj.id}:${reflected}`);
        };
        objectSubscription.onAdd(obj =>
            record(objectTransitions, "add", objectSubscription.objects, obj)
        );
        objectSubscription.onRemove(obj =>
            record(
                objectTransitions,
                "remove",
                objectSubscription.objects,
                obj,
            )
        );
        contextSubscription.onAdd(obj =>
            record(
                contextTransitions,
                "add",
                contextSubscription.objects,
                obj,
            )
        );
        contextSubscription.onRemove(obj =>
            record(
                contextTransitions,
                "remove",
                contextSubscription.objects,
                obj,
            )
        );

        const before = {
            object: objectSubscription.objects.map(obj => obj.id),
            context: contextSubscription.objects.map(obj => obj.id),
        };
        objectOptions.include = "option-blue";
        contextOptions.include = "option-blue";
        await k.nextFrame();

        return {
            before,
            after: {
                object: objectSubscription.objects.map(obj => obj.id),
                objectSnapshot: owner.query(objectOptions).map(obj => obj.id),
                context: contextSubscription.objects.map(obj => obj.id),
                contextSnapshot: k.query(contextOptions).map(obj => obj.id),
            },
            objectTransitions,
            contextTransitions,
            red: red.id,
            blue: blue.id,
        };
    });

    expect(result.before).toEqual({
        object: [result.red],
        context: [result.red],
    });
    expect(result.after).toEqual({
        object: [result.blue],
        objectSnapshot: [result.blue],
        context: [result.blue],
        contextSnapshot: [result.blue],
    });
    const expectedTransitions = new Set([
        `remove:${result.red}:true`,
        `add:${result.blue}:true`,
    ]);
    expect(new Set(result.objectTransitions)).toEqual(expectedTransitions);
    expect(result.objectTransitions).toHaveLength(2);
    expect(new Set(result.contextTransitions)).toEqual(expectedTransitions);
    expect(result.contextTransitions).toHaveLength(2);
});

test("array query operators stay aligned with snapshot queries", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const first = owner.add(["alpha"]);
        const second = owner.add(["beta", "blocked"]);
        owner.add(["alpha", "beta", "muted"]);
        const fourth = owner.add(["beta"]);
        const options = {
            include: ["alpha", "beta"],
            includeOp: "or" as const,
            exclude: ["blocked", "muted"],
            excludeOp: "or" as const,
            hierarchy: "children" as const,
        };
        const subscription = owner.watchQuery(options);
        const ids = (objects: readonly GameObj[]) =>
            objects.map(obj => obj.id).sort();
        const initial = {
            live: ids(subscription.objects),
            snapshot: ids(owner.query(options)),
        };

        first.tag("blocked");
        second.untag("blocked");
        const changed = {
            live: ids(subscription.objects),
            snapshot: ids(owner.query(options)),
        };

        return {
            initial,
            changed,
            first: first.id,
            second: second.id,
            fourth: fourth.id,
        };
    });

    expect(result.initial.live).toEqual(result.initial.snapshot);
    expect(result.initial.live).toEqual([result.first, result.fourth].sort());
    expect(result.changed.live).toEqual(result.changed.snapshot);
    expect(result.changed.live).toEqual([result.second, result.fourth].sort());
});

test("context subscriptions preserve composed snapshot filters", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay();
        const branch = k.add([]);
        const first = branch.add([
            "alpha",
            k.named("target"),
            { id: "visibility", visible: true },
        ]);
        const second = branch.add([
            "beta",
            "blocked",
            k.named("target"),
            { id: "visibility", visible: true },
        ]);
        const third = branch.add([
            "alpha",
            "beta",
            "muted",
            k.named("other"),
            { id: "visibility", visible: true },
        ]);
        const fourth = branch.add([
            "beta",
            k.named("target"),
            { id: "visibility", visible: false },
        ]);
        const options = {
            include: ["alpha", "beta"],
            includeOp: "or" as const,
            exclude: ["blocked", "muted"],
            excludeOp: "or" as const,
            hierarchy: "descendants" as const,
            visible: true,
            name: "target",
        };
        const subscription = k.watchQuery(options);
        const ids = (objects: readonly GameObj[]) =>
            objects.map(obj => obj.id).sort();
        const callbacks: {
            kind: "add" | "remove";
            id: number;
            live: number[];
            snapshot: number[];
        }[] = [];
        const observe = (kind: "add" | "remove", obj: GameObj) => {
            callbacks.push({
                kind,
                id: obj.id,
                live: ids(subscription.objects),
                snapshot: ids(k.query(options)),
            });
        };
        subscription.onAdd(obj => observe("add", obj));
        subscription.onRemove(obj => observe("remove", obj));
        const initial = {
            live: ids(subscription.objects),
            snapshot: ids(k.query(options)),
        };

        first.tag("blocked");
        const afterTag = ids(subscription.objects);
        second.untag("blocked");
        const afterUntag = ids(subscription.objects);
        const componentMatch = branch.add([
            "alpha",
            { id: "visibility", visible: true },
        ]);
        componentMatch.use(k.named("target"));
        const afterComponent = ids(subscription.objects);
        const structuralMatch = k.add([
            "alpha",
            k.named("target"),
            { id: "visibility", visible: true },
        ]);
        const afterStructural = ids(subscription.objects);
        fourth.visible = true;
        await k.nextFrame();
        const changed = {
            live: ids(subscription.objects),
            snapshot: ids(k.query(options)),
        };

        return {
            initial,
            afterTag,
            afterUntag,
            afterComponent,
            afterStructural,
            changed,
            callbacks,
            first: first.id,
            second: second.id,
            third: third.id,
            fourth: fourth.id,
            componentMatch: componentMatch.id,
            structuralMatch: structuralMatch.id,
        };
    });

    expect(result.initial.live).toEqual(result.initial.snapshot);
    expect(result.initial.live).toEqual([result.first]);
    expect(result.afterTag).toEqual([]);
    expect(result.afterUntag).toEqual([result.second]);
    expect(result.afterComponent).toEqual(
        [result.second, result.componentMatch].sort(),
    );
    expect(result.afterStructural).toEqual(
        [result.second, result.componentMatch, result.structuralMatch].sort(),
    );
    expect(result.changed.live).toEqual(result.changed.snapshot);
    expect(result.changed.live).toEqual(
        [
            result.second,
            result.fourth,
            result.componentMatch,
            result.structuralMatch,
        ].sort(),
    );
    expect(result.callbacks.map(({ kind, id }) => [kind, id])).toEqual([
        ["remove", result.first],
        ["add", result.second],
        ["add", result.componentMatch],
        ["add", result.structuralMatch],
        ["add", result.fourth],
    ]);
    for (const callback of result.callbacks) {
        expect(callback.live).toEqual(callback.snapshot);
    }
});

test("all hierarchy modes follow moves and recursive subtree membership", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const rootA = k.add(["tracked"]);
        const rootB = k.add(["tracked"]);
        const branch = rootA.add(["tracked"]);
        const leaf = branch.add(["tracked"]);
        const peer = rootA.add(["tracked"]);
        const childQuery = rootA.watchQuery({
            include: "tracked",
            hierarchy: "children",
        });
        const descendantQuery = rootA.watchQuery({
            include: "tracked",
            hierarchy: "descendants",
        });
        const siblingQuery = peer.watchQuery({
            include: "tracked",
            hierarchy: "siblings",
        });
        const ancestorQuery = leaf.watchQuery({
            include: "tracked",
            hierarchy: "ancestors",
        });
        const ids = (objects: readonly GameObj[]) =>
            objects.map(obj => obj.id).sort();
        const before = {
            children: ids(childQuery.objects),
            descendants: ids(descendantQuery.objects),
            siblings: ids(siblingQuery.objects),
            ancestors: ids(ancestorQuery.objects),
        };

        branch.setParent(rootB, { keep: 0 });
        const after = {
            children: ids(childQuery.objects),
            descendants: ids(descendantQuery.objects),
            siblings: ids(siblingQuery.objects),
            ancestors: ids(ancestorQuery.objects),
        };

        return {
            before,
            after,
            rootA: rootA.id,
            rootB: rootB.id,
            branch: branch.id,
            leaf: leaf.id,
            peer: peer.id,
        };
    });

    expect(result.before).toEqual({
        children: [result.branch, result.peer].sort(),
        descendants: [result.branch, result.leaf, result.peer].sort(),
        siblings: [result.branch].sort(),
        ancestors: [result.rootA, result.branch].sort(),
    });
    expect(result.after).toEqual({
        children: [result.peer],
        descendants: [result.peer],
        siblings: [],
        ancestors: [result.rootB, result.branch].sort(),
    });
});

test("destination queries receive every matching member of a moved subtree", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const source = k.add([]);
        const destination = k.add([]);
        const branch = source.add(["tracked"]);
        const middle = branch.add([]);
        const leaf = middle.add(["tracked"]);
        const children = destination.watchQuery({
            include: "tracked",
            hierarchy: "children",
        });
        const descendants = destination.watchQuery({
            include: "tracked",
            hierarchy: "descendants",
        });
        const sourceDescendants = source.watchQuery({
            include: "tracked",
            hierarchy: "descendants",
        });
        const additions: number[] = [];
        const additionStates: boolean[] = [];
        const removalStates: boolean[] = [];
        const removals: number[] = [];
        descendants.onAdd(obj => {
            additions.push(obj.id);
            additionStates.push(descendants.objects.includes(obj));
        });
        sourceDescendants.onRemove(obj => {
            removals.push(obj.id);
            removalStates.push(!sourceDescendants.objects.includes(obj));
        });

        branch.parent = destination;

        return {
            children: children.objects.map(obj => obj.id).sort(),
            descendants: descendants.objects.map(obj => obj.id).sort(),
            additions: additions.sort(),
            additionStates,
            removals: removals.sort(),
            removalStates,
            branch: branch.id,
            leaf: leaf.id,
        };
    });

    const expectedDescendants = [result.branch, result.leaf].sort();
    expect(result.children).toEqual([result.branch]);
    expect(result.descendants).toEqual(expectedDescendants);
    expect(result.additions).toEqual(expectedDescendants);
    expect(result.additionStates).toEqual([true, true]);
    expect(result.removals).toEqual(expectedDescendants);
    expect(result.removalStates).toEqual([true, true]);
});

test("repeated and same-scope mutations emit only real membership transitions", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const firstBranch = owner.add([]);
        const secondBranch = owner.add([]);
        const item = firstBranch.add(["tracked"]);
        const subscription = owner.watchQuery({
            include: "tracked",
            hierarchy: "descendants",
        });
        let adds = 0;
        let removes = 0;
        subscription.onAdd(() => adds++);
        subscription.onRemove(() => removes++);

        item.parent = item.parent;
        item.parent = secondBranch;
        item.tag("tracked");
        item.untag("tracked");
        item.untag("tracked");
        item.tag("tracked");
        item.tag("tracked");

        const reentrantItem = firstBranch.add(["reentrant"]);
        const reentrantSubscription = owner.watchQuery({
            include: "reentrant",
            hierarchy: "descendants",
        });
        const reentrantTransitions: Array<{
            kind: "add" | "remove";
            reflected: boolean;
        }> = [];
        let restore = true;
        reentrantSubscription.onAdd(obj => {
            reentrantTransitions.push({
                kind: "add",
                reflected: reentrantSubscription.objects.includes(obj),
            });
        });
        reentrantSubscription.onRemove(obj => {
            reentrantTransitions.push({
                kind: "remove",
                reflected: !reentrantSubscription.objects.includes(obj),
            });
            if (restore) {
                restore = false;
                obj.tag("reentrant");
            }
        });
        reentrantItem.untag("reentrant");

        return {
            objects: subscription.objects.map(obj => obj.id),
            unique: new Set(subscription.objects).size,
            adds,
            removes,
            item: item.id,
            reentrantObjects: reentrantSubscription.objects.map(obj => obj.id),
            reentrantSnapshot: owner.query({
                include: "reentrant",
                hierarchy: "descendants",
            }).map(obj => obj.id),
            reentrantTransitions,
            reentrantItem: reentrantItem.id,
        };
    });

    expect(result.objects).toEqual([result.item]);
    expect(result.unique).toBe(1);
    expect(result.adds).toBe(1);
    expect(result.removes).toBe(1);
    expect(result.reentrantObjects).toEqual([result.reentrantItem]);
    expect(result.reentrantObjects).toEqual(result.reentrantSnapshot);
    expect(result.reentrantTransitions).toEqual([
        { kind: "remove", reflected: true },
        { kind: "add", reflected: true },
    ]);
});

test("component cleanup updates property filters before unuse returns", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const item = owner.add([k.named("target")]);
        const subscription = owner.watchQuery({
            hierarchy: "children",
            name: "target",
        });
        const before = subscription.objects.map(obj => obj.id);

        item.unuse("named");

        return {
            before,
            live: subscription.objects.map(obj => obj.id),
            snapshot: owner.query({
                hierarchy: "children",
                name: "target",
            }).map(obj => obj.id),
            item: item.id,
        };
    });

    expect(result.before).toEqual([result.item]);
    expect(result.live).toEqual([]);
    expect(result.live).toEqual(result.snapshot);
});

test("anonymous component additions update property filters before use returns", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const item = owner.add([]);
        const subscription = owner.watchQuery({
            hierarchy: "children",
            name: "target",
        });
        const additions: Array<{ id: number; present: boolean }> = [];
        subscription.onAdd(obj => {
            additions.push({
                id: obj.id,
                present: subscription.objects.includes(obj),
            });
        });

        item.use({ name: "target" } as Comp & { name: string });

        return {
            live: subscription.objects.map(obj => obj.id),
            snapshot: owner.query({
                hierarchy: "children",
                name: "target",
            }).map(obj => obj.id),
            additions,
            item: item.id,
        };
    });

    expect(result.live).toEqual([result.item]);
    expect(result.live).toEqual(result.snapshot);
    expect(result.additions).toEqual([{ id: result.item, present: true }]);
});

test("root component additions update ancestor subscriptions before use returns", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const root = k.getTreeRoot();
        const child = k.add([]);
        const subscription = child.watchQuery({
            hierarchy: "ancestors",
            name: "root",
        });
        const before = subscription.objects.map(obj => obj.id);

        root.use(k.named("root"));

        return {
            before,
            live: subscription.objects.map(obj => obj.id),
            snapshot: child.query({
                hierarchy: "ancestors",
                name: "root",
            }).map(obj => obj.id),
            root: root.id,
        };
    });

    expect(result.before).toEqual([]);
    expect(result.live).toEqual([result.root]);
    expect(result.live).toEqual(result.snapshot);
});

test("callback controllers and subscription cancellation are independent", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const first = owner.add(["tracked"]);
        const subscription = owner.watchQuery({
            include: "tracked",
            hierarchy: "children",
        });
        const frozen = subscription.objects;
        const cancelledBefore = subscription.cancelled;
        let retainedCallback = 0;
        let cancelledCallback = 0;
        let retainedRemoveCallback = 0;
        let cancelledRemoveCallback = 0;
        subscription.onAdd(() => retainedCallback++);
        const controller = subscription.onAdd(() => cancelledCallback++);
        controller.cancel();
        subscription.onRemove(() => retainedRemoveCallback++);
        const removeController = subscription.onRemove(() => {
            cancelledRemoveCallback++;
        });
        removeController.cancel();

        const second = owner.add(["tracked"]);
        first.untag("tracked");
        subscription.cancel();
        subscription.cancel();
        second.untag("tracked");
        owner.add(["tracked"]);

        return {
            cancelledBefore,
            cancelled: subscription.cancelled,
            sameObjects: frozen === subscription.objects,
            frozenCount: frozen.length,
            retainedCallback,
            cancelledCallback,
            retainedRemoveCallback,
            cancelledRemoveCallback,
        };
    });

    expect(result).toEqual({
        cancelledBefore: false,
        cancelled: true,
        sameObjects: true,
        frozenCount: 1,
        retainedCallback: 1,
        cancelledCallback: 0,
        retainedRemoveCallback: 1,
        cancelledRemoveCallback: 0,
    });
});

test("context and object subscriptions honor their lifecycle owners", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay();
        let contextSubscription!: ReturnType<typeof k.watchQuery>;
        let objectSubscription!: ReturnType<typeof k.watchQuery>;
        let contextLiveGet!: GameObj[];
        let objectLiveGet!: GameObj[];
        let owner!: GameObj;

        k.scene("first", () => {
            owner = k.add([k.stay()]);
            owner.add(["tracked"]);
            contextSubscription = k.watchQuery({
                include: "tracked",
                hierarchy: "descendants",
            });
            objectSubscription = owner.watchQuery({
                include: "tracked",
                hierarchy: "children",
            });
            contextLiveGet = k.get("tracked", {
                recursive: true,
                liveUpdate: true,
            });
            objectLiveGet = owner.get("tracked", { liveUpdate: true });
        });
        k.scene("second", () => {
            owner.add(["tracked"]);
        });
        const frame = () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => resolve());
            });

        k.go("first");
        await frame();
        await frame();
        const before = {
            context: contextSubscription.objects.length,
            object: objectSubscription.objects.length,
            contextLiveGet: contextLiveGet.length,
            objectLiveGet: objectLiveGet.length,
        };

        k.go("second");
        await frame();
        await frame();
        const afterScene = {
            contextCancelled: contextSubscription.cancelled,
            context: contextSubscription.objects.length,
            objectCancelled: objectSubscription.cancelled,
            object: objectSubscription.objects.length,
            contextLiveGet: contextLiveGet.length,
            objectLiveGet: objectLiveGet.length,
        };

        owner.destroy();
        return {
            before,
            afterScene,
            objectCancelledAfterDestroy: objectSubscription.cancelled,
        };
    });

    expect(result).toEqual({
        before: {
            context: 1,
            object: 1,
            contextLiveGet: 1,
            objectLiveGet: 1,
        },
        afterScene: {
            contextCancelled: true,
            context: 1,
            objectCancelled: false,
            object: 2,
            contextLiveGet: 1,
            objectLiveGet: 2,
        },
        objectCancelledAfterDestroy: true,
    });
});

test("root object subscriptions survive scene changes while context queries stop", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay();
        const root = k.getTreeRoot();
        let firstId!: number;
        let secondId!: number;
        let contextWatch!: ReturnType<typeof k.watchQuery>;
        let rootWatch!: ReturnType<typeof k.watchQuery>;
        let contextLive!: GameObj[];
        let rootLive!: GameObj[];
        const options = { include: "tracked", hierarchy: "children" as const };

        k.scene("first", () => {
            firstId = k.add([k.stay(), "tracked"]).id;
            contextWatch = k.watchQuery(options);
            rootWatch = root.watchQuery(options);
            contextLive = k.get("tracked", { liveUpdate: true });
            rootLive = root.get("tracked", { liveUpdate: true });
        });
        k.scene("second", () => {
            secondId = k.add(["tracked"]).id;
        });
        const frame = () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => resolve());
            });

        k.go("first");
        await frame();
        await frame();
        const before = {
            contextWatch: contextWatch.objects.map(obj => obj.id),
            rootWatch: rootWatch.objects.map(obj => obj.id),
            contextLive: contextLive.map(obj => obj.id),
            rootLive: rootLive.map(obj => obj.id),
        };

        k.go("second");
        await frame();
        await frame();
        return {
            before,
            after: {
                contextCancelled: contextWatch.cancelled,
                rootCancelled: rootWatch.cancelled,
                contextWatch: contextWatch.objects.map(obj => obj.id),
                rootWatch: rootWatch.objects.map(obj => obj.id).sort(),
                contextLive: contextLive.map(obj => obj.id),
                rootLive: rootLive.map(obj => obj.id).sort(),
            },
            first: firstId,
            second: secondId,
        };
    });

    expect(result.before).toEqual({
        contextWatch: [result.first],
        rootWatch: [result.first],
        contextLive: [result.first],
        rootLive: [result.first],
    });
    const both = [result.first, result.second].sort();
    expect(result.after).toEqual({
        contextCancelled: true,
        rootCancelled: false,
        contextWatch: [result.first],
        rootWatch: both,
        contextLive: [result.first],
        rootLive: both,
    });
});

test("legacy live get matching modes retain their lifecycle ownership", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const k = kaplay({ tagComponentIds: false });
        let contextTags!: GameObj[];
        let contextComps!: GameObj[];
        let objectTags!: GameObj[];
        let objectComps!: GameObj[];
        let owner!: GameObj;

        k.scene("first", () => {
            owner = k.add([k.stay()]);
            owner.add(["tagged"]);
            owner.add([{ id: "component" }]);
            contextTags = k.get("tagged", {
                recursive: true,
                liveUpdate: true,
                only: "tags",
            });
            contextComps = k.get("component", {
                recursive: true,
                liveUpdate: true,
                only: "comps",
            });
            objectTags = owner.get("tagged", {
                liveUpdate: true,
                only: "tags",
            });
            objectComps = owner.get("component", {
                liveUpdate: true,
                only: "comps",
            });
        });
        k.scene("second", () => {
            owner.add(["tagged"]);
            owner.add([{ id: "component" }]);
        });
        const frame = () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => resolve());
            });

        k.go("first");
        await frame();
        await frame();
        const before = {
            contextTags: contextTags.length,
            contextComps: contextComps.length,
            objectTags: objectTags.length,
            objectComps: objectComps.length,
        };

        k.go("second");
        await frame();
        await frame();
        return {
            before,
            after: {
                contextTags: contextTags.length,
                contextComps: contextComps.length,
                objectTags: objectTags.length,
                objectComps: objectComps.length,
            },
        };
    });

    expect(result).toEqual({
        before: {
            contextTags: 1,
            contextComps: 1,
            objectTags: 1,
            objectComps: 1,
        },
        after: {
            contextTags: 1,
            contextComps: 1,
            objectTags: 2,
            objectComps: 2,
        },
    });
});

test("legacy live get queries share hierarchy coherence while snapshots stay fixed", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay({ tagComponentIds: true });
        const left = k.add([]);
        const branch = left.add([]);
        const item = branch.add([{ id: "marker" }]);
        const liveTags = left.get("marker", {
            recursive: true,
            liveUpdate: true,
            only: "tags",
        });
        const liveComps = left.get("marker", {
            recursive: true,
            liveUpdate: true,
            only: "comps",
        });
        const snapshot = left.get("marker", {
            recursive: true,
            only: "comps",
        });
        const subscription = left.watchQuery({
            include: "marker",
            hierarchy: "descendants",
        });

        branch.parent = null;
        const movedOut = {
            tags: liveTags.map(obj => obj.id),
            comps: liveComps.map(obj => obj.id),
            subscription: subscription.objects.map(obj => obj.id),
            snapshot: snapshot.map(obj => obj.id),
        };
        branch.parent = left;
        const reattached = {
            tags: liveTags.map(obj => obj.id),
            comps: liveComps.map(obj => obj.id),
            subscription: subscription.objects.map(obj => obj.id),
        };
        item.unuse("marker");
        item.use({ id: "marker" });

        return {
            movedOut,
            reattached,
            currentTags: liveTags.map(obj => obj.id),
            currentComps: liveComps.map(obj => obj.id),
            currentSubscription: subscription.objects.map(obj => obj.id),
            item: item.id,
        };
    });

    expect(result.movedOut).toEqual({
        tags: [],
        comps: [],
        subscription: [],
        snapshot: [result.item],
    });
    expect(result.reattached).toEqual({
        tags: [result.item],
        comps: [result.item],
        subscription: [result.item],
    });
    expect(result.currentTags).toEqual([result.item]);
    expect(result.currentComps).toEqual([result.item]);
    expect(result.currentSubscription).toEqual([result.item]);
});

test("independent subscriptions and snapshot queries do not share mutable state", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const first = owner.add(["red"]);
        const red = owner.watchQuery({
            include: "red",
            hierarchy: "children",
        });
        const redCopy = owner.watchQuery({
            include: "red",
            hierarchy: "children",
        });
        const blue = owner.watchQuery({
            include: "blue",
            hierarchy: "children",
        });
        const redStates: number[][] = [];
        const redCopyStates: number[][] = [];
        red.onAdd(() => redStates.push(red.objects.map(obj => obj.id)));
        red.onRemove(() => redStates.push(red.objects.map(obj => obj.id)));
        redCopy.onAdd(() =>
            redCopyStates.push(redCopy.objects.map(obj => obj.id))
        );
        redCopy.onRemove(() =>
            redCopyStates.push(redCopy.objects.map(obj => obj.id))
        );
        const snapshot = owner.query({
            include: "red",
            hierarchy: "children",
        });

        first.untag("red");
        first.tag("blue");
        const second = owner.add(["red"]);
        const secondId = second.id;
        second.destroy();

        return {
            red: red.objects.map(obj => obj.id),
            redCopy: redCopy.objects.map(obj => obj.id),
            distinctArrays: red.objects !== redCopy.objects,
            redStates,
            redCopyStates,
            blue: blue.objects.map(obj => obj.id),
            snapshot: snapshot.map(obj => obj.id),
            first: first.id,
            second: secondId,
        };
    });

    expect(result.red).toEqual([]);
    expect(result.redCopy).toEqual([]);
    expect(result.distinctArrays).toBe(true);
    expect(result.redStates).toEqual([[], [result.second], []]);
    expect(result.redCopyStates).toEqual([[], [result.second], []]);
    expect(result.blue).toEqual([result.first]);
    expect(result.snapshot).toEqual([result.first]);
});

test("unfiltered child queries remain snapshots after later mutations", async ({ page }) => {
    const result = await page.evaluate(() => {
        const k = kaplay();
        const owner = k.add([]);
        const first = owner.add([]);
        const implicit = owner.query({});
        const explicit = owner.query({ hierarchy: "children" });
        const initial = {
            implicit: implicit.map(obj => obj.id),
            explicit: explicit.map(obj => obj.id),
        };

        owner.add([]);
        const afterAdd = {
            implicit: implicit.map(obj => obj.id),
            explicit: explicit.map(obj => obj.id),
        };

        first.parent = null;
        const afterRemove = {
            implicit: implicit.map(obj => obj.id),
            explicit: explicit.map(obj => obj.id),
        };

        return {
            first: first.id,
            initial,
            afterAdd,
            afterRemove,
        };
    });

    const expected = {
        implicit: [result.first],
        explicit: [result.first],
    };
    expect(result.initial).toEqual(expected);
    expect(result.afterAdd).toEqual(expected);
    expect(result.afterRemove).toEqual(expected);
});
