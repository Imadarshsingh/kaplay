#!/usr/bin/env bash

set -u

OUTPUT_PATH=""
MODE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output_path|--output-path)
            if [[ $# -lt 2 ]]; then
                printf 'Missing value for %s\n' "$1" >&2
                exit 2
            fi
            OUTPUT_PATH="$2"
            shift 2
            ;;
        base|new)
            MODE="$1"
            shift
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$OUTPUT_PATH" || -z "$MODE" ]]; then
    printf 'Usage: ./test.sh --output_path <path> <base|new>\n' >&2
    exit 2
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
LOG_PATH="$(mktemp)"
CHECK_LOG_PATH="$(mktemp)"
JUNIT_PATH="$(mktemp)"
rm -f "$JUNIT_PATH"

write_fallback_junit() {
    local status="$1"
    local phase="$2"
    TEST_STATUS="$status" TEST_PHASE="$phase" TEST_MODE="$MODE" \
        TEST_LOG_PATH="$LOG_PATH" TEST_OUTPUT_PATH="$OUTPUT_PATH" \
        node --input-type=module -e '
            import fs from "node:fs";
            const escapeXml = (value) => value
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll("\"", "&quot;")
                .replaceAll("\u0027", "&apos;");
            const log = fs.existsSync(process.env.TEST_LOG_PATH)
                ? fs.readFileSync(process.env.TEST_LOG_PATH, "utf8")
                : "No runner output was captured.";
            const name = `${process.env.TEST_MODE} ${process.env.TEST_PHASE}`;
            const message = `${process.env.TEST_PHASE} failed with exit code ${process.env.TEST_STATUS}`;
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
                + `<testsuites name="kaplay" tests="1" failures="1" errors="0" skipped="0" time="0">\n`
                + `  <testsuite name="kaplay.${escapeXml(process.env.TEST_MODE)}" tests="1" failures="1" errors="0" skipped="0" time="0">\n`
                + `    <testcase name="${escapeXml(name)}" classname="kaplay.${escapeXml(process.env.TEST_MODE)}" time="0">\n`
                + `      <failure message="${escapeXml(message)}">${escapeXml(log)}</failure>\n`
                + `      <system-out>${escapeXml(log)}</system-out>\n`
                + `    </testcase>\n`
                + `  </testsuite>\n`
                + `</testsuites>\n`;
            fs.writeFileSync(process.env.TEST_OUTPUT_PATH, xml);
        '
}

append_typecheck_junit() {
    TEST_STATUS="$CHECK_STATUS" TEST_MODE="$MODE" \
        TEST_LOG_PATH="$CHECK_LOG_PATH" TEST_OUTPUT_PATH="$OUTPUT_PATH" \
        node --input-type=module -e '
            import fs from "node:fs";
            const escapeXml = (value) => value
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll("\"", "&quot;")
                .replaceAll("\u0027", "&apos;");
            const bump = (tag, attribute) => tag.replace(
                new RegExp(`${attribute}="(\\d+)"`),
                (_, count) => `${attribute}="${Number(count) + 1}"`,
            );
            const log = fs.readFileSync(process.env.TEST_LOG_PATH, "utf8");
            let xml = fs.readFileSync(process.env.TEST_OUTPUT_PATH, "utf8");
            const failed = Number(process.env.TEST_STATUS) !== 0;
            xml = xml.replace(
                /<testsuites\b[^>]*>/,
                (tag) => failed
                    ? bump(bump(tag, "tests"), "failures")
                    : bump(tag, "tests"),
            );
            const failure = failed
                ? `      <failure message="typecheck failed with exit code ${process.env.TEST_STATUS}">${escapeXml(log)}</failure>\n`
                : "";
            const suite = `  <testsuite name="kaplay.typecheck" tests="1" failures="${failed ? 1 : 0}" errors="0" skipped="0" time="0">\n`
                + `    <testcase name="${escapeXml(process.env.TEST_MODE)} public API typecheck" classname="kaplay.typecheck" time="0">\n`
                + failure
                + `      <system-out>${escapeXml(log)}</system-out>\n`
                + `    </testcase>\n`
                + `  </testsuite>\n`;
            xml = xml.replace("</testsuites>", `${suite}</testsuites>`);
            fs.writeFileSync(process.env.TEST_OUTPUT_PATH, xml);
        '
}

CHECK_STATUS=0
if [[ "$MODE" == "new" ]]; then
    ./node_modules/.bin/tsc --noEmit \
        --project tests/tsconfig.audio-channel-7f31c2.json \
        2>&1 | tee "$CHECK_LOG_PATH"
    CHECK_STATUS=${PIPESTATUS[0]}
fi

npm run build 2>&1 | tee "$LOG_PATH"
BUILD_STATUS=${PIPESTATUS[0]}

if [[ $BUILD_STATUS -ne 0 ]]; then
    write_fallback_junit "$BUILD_STATUS" "build"
    if [[ "$MODE" == "new" ]]; then
        append_typecheck_junit
    fi
    rm -f "$LOG_PATH" "$CHECK_LOG_PATH" "$JUNIT_PATH"
    exit "$BUILD_STATUS"
fi

: > "$LOG_PATH"
export PLAYWRIGHT_JUNIT_OUTPUT_FILE="$JUNIT_PATH"

if [[ "$MODE" == "base" ]]; then
    ./node_modules/.bin/playwright test \
        tests/integration/components \
        tests/integration/core \
        tests/integration/entity \
        tests/integration/gfx \
        --workers=2 --reporter=junit 2>&1 | tee "$LOG_PATH"
else
    ./node_modules/.bin/playwright test \
        tests/integration/audioChannel.22a9d4.spec.ts \
        tests/integration/audioRouting.bfb646.spec.ts \
        --workers=2 --reporter=junit 2>&1 | tee "$LOG_PATH"
fi
RUN_STATUS=${PIPESTATUS[0]}
FINAL_STATUS=$RUN_STATUS

if [[ -s "$JUNIT_PATH" ]]; then
    cp "$JUNIT_PATH" "$OUTPUT_PATH"
    if [[ "$MODE" == "new" ]]; then
        append_typecheck_junit
        if [[ $CHECK_STATUS -ne 0 ]]; then
            FINAL_STATUS=$CHECK_STATUS
        fi
    fi
else
    if [[ $RUN_STATUS -eq 0 ]]; then
        RUN_STATUS=1
    fi
    write_fallback_junit "$RUN_STATUS" "test runner"
    if [[ "$MODE" == "new" ]]; then
        append_typecheck_junit
    fi
    FINAL_STATUS=$RUN_STATUS
fi

rm -f "$LOG_PATH" "$CHECK_LOG_PATH" "$JUNIT_PATH"
exit "$FINAL_STATUS"
