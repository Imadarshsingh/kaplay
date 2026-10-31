import { runes } from "../utils/runes";

const combiningMarks = /^\p{M}+$/u;

function countCanonicalGraphemes(label: string, locale?: string): number {
    const graphemes = runes(label.normalize("NFC"), locale);
    let count = 0;

    for (const grapheme of graphemes) {
        if (count > 0 && combiningMarks.test(grapheme)) {
            continue;
        }
        count++;
    }

    return count;
}

export type FontLigatureMatch = {
    label: string;
    sourceLength: number;
};

class FontLigatureEntry {
    readonly units: string[];
    private readonly graphemeCounts = new Map<string, number>();

    constructor(
        readonly label: string,
        readonly order: number,
    ) {
        this.units = Array.from(label.normalize("NFD"));
    }

    graphemeCount(locale?: string): number {
        const key = locale ?? "";
        const cached = this.graphemeCounts.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const count = countCanonicalGraphemes(this.label, locale);
        this.graphemeCounts.set(key, count);
        return count;
    }
}

class FontLigatureNode {
    readonly children = new Map<string, FontLigatureNode>();
    readonly entries: FontLigatureEntry[] = [];

    child(unit: string): FontLigatureNode {
        let child = this.children.get(unit);
        if (!child) {
            child = new FontLigatureNode();
            this.children.set(unit, child);
        }
        return child;
    }
}

type FontLigatureCandidate = FontLigatureMatch & {
    graphemeCount: number;
    order: number;
};

export class FontLigatureMatcher {
    private readonly root = new FontLigatureNode();
    private hasEntries = false;
    private maxUnits = 0;

    constructor(labels: readonly string[]) {
        for (const [order, label] of labels.entries()) {
            const entry = new FontLigatureEntry(label, order);
            if (
                entry.units.includes("\n")
                || entry.graphemeCount() <= 1
            ) {
                continue;
            }

            let node = this.root;
            for (const unit of entry.units) {
                node = node.child(unit);
            }
            node.entries.push(entry);
            this.hasEntries = true;
            this.maxUnits = Math.max(this.maxUnits, entry.units.length);
        }
    }

    match(
        chars: readonly string[],
        cursor: number,
        styleRuns: readonly number[],
        locale?: string,
    ): FontLigatureMatch | null {
        if (!this.hasEntries || cursor >= chars.length) {
            return null;
        }

        const startingRun = styleRuns[cursor];
        let best: FontLigatureCandidate | null = null;
        let source = "";

        for (let end = cursor; end < chars.length; end++) {
            if (
                styleRuns[end] !== startingRun
                || chars[end] === "\n"
            ) {
                break;
            }

            source += chars[end];
            const units = Array.from(source.normalize("NFD"));
            if (units.length > this.maxUnits) {
                break;
            }

            let node = this.root;
            let matchesPrefix = true;
            for (const unit of units) {
                const child = node.children.get(unit);
                if (!child) {
                    matchesPrefix = false;
                    break;
                }
                node = child;
            }

            if (!matchesPrefix) {
                continue;
            }

            for (const entry of node.entries) {
                const graphemeCount = entry.graphemeCount(locale);
                if (
                    !best
                    || graphemeCount > best.graphemeCount
                    || (graphemeCount === best.graphemeCount
                        && entry.order < best.order)
                ) {
                    best = {
                        label: entry.label,
                        sourceLength: end - cursor + 1,
                        graphemeCount,
                        order: entry.order,
                    };
                }
            }
        }

        if (!best) {
            return null;
        }

        return {
            label: best.label,
            sourceLength: best.sourceLength,
        };
    }
}

const matcherCache = new WeakMap<readonly string[], FontLigatureMatcher>();
const emptyMatcher = new FontLigatureMatcher([]);

export function getFontLigatureMatcher(
    labels: readonly string[] | undefined,
): FontLigatureMatcher {
    if (!labels || labels.length === 0) {
        return emptyMatcher;
    }

    let matcher = matcherCache.get(labels);
    if (!matcher) {
        matcher = new FontLigatureMatcher(labels);
        matcherCache.set(labels, matcher);
    }
    return matcher;
}
