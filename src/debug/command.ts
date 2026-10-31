export function parseCommandLine(line: string): string[] {
    const tokens: string[] = [];
    let token = "";
    let quote: "'" | "\"" | null = null;
    let escaped = false;
    let started = false;

    for (const character of line) {
        if (escaped) {
            token += character;
            started = true;
            escaped = false;
            continue;
        }

        if (character === "\\") {
            escaped = true;
            started = true;
            continue;
        }

        if (quote !== null) {
            if (character === quote) {
                quote = null;
            }
            else {
                token += character;
            }
            started = true;
            continue;
        }

        if (character === "'" || character === "\"") {
            quote = character;
            started = true;
            continue;
        }

        if (/\s/.test(character)) {
            if (started) {
                tokens.push(token);
                token = "";
                started = false;
            }
            continue;
        }

        token += character;
        started = true;
    }

    if (escaped) {
        throw new Error("Command cannot end with an escape character");
    }
    if (quote !== null) {
        throw new Error("Command contains an unterminated quote");
    }
    if (started) {
        tokens.push(token);
    }

    return tokens;
}
