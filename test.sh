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
BUILD_LOG="$(mktemp)"
RUN_LOG="$(mktemp)"
TYPE_LOG="$(mktemp)"
JUNIT_PATH="$(mktemp)"
rm -f "$JUNIT_PATH"

write_report() {
    local status="$1"
    local phase="$2"
    local log_path="$3"
    TEST_STATUS="$status" TEST_PHASE="$phase" TEST_MODE="$MODE" \
        TEST_LOG_PATH="$log_path" TEST_OUTPUT_PATH="$OUTPUT_PATH" \
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
                : "No output was captured.";
            const failed = Number(process.env.TEST_STATUS) !== 0;
            const phase = process.env.TEST_PHASE;
            const classname = `kaplay.${process.env.TEST_MODE}.${phase.replaceAll(" ", "-")}`;
            const failure = failed
                ? `      <failure message="${escapeXml(phase)} failed with exit code ${process.env.TEST_STATUS}">${escapeXml(log)}</failure>\n`
                : "";
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
                + `<testsuites name="kaplay" tests="1" failures="${failed ? 1 : 0}" errors="0" skipped="0" time="0">\n`
                + `  <testsuite name="kaplay.${escapeXml(process.env.TEST_MODE)}" tests="1" failures="${failed ? 1 : 0}" errors="0" skipped="0" time="0">\n`
                + `    <testcase name="${escapeXml(phase)}" classname="${escapeXml(classname)}" time="0">\n`
                + failure
                + `      <system-out>${escapeXml(log)}</system-out>\n`
                + `    </testcase>\n`
                + `  </testsuite>\n`
                + `</testsuites>\n`;
            fs.writeFileSync(process.env.TEST_OUTPUT_PATH, xml);
        '
}

append_result() {
    local status="$1"
    local phase="$2"
    local log_path="$3"
    TEST_STATUS="$status" TEST_PHASE="$phase" TEST_MODE="$MODE" \
        TEST_LOG_PATH="$log_path" TEST_OUTPUT_PATH="$OUTPUT_PATH" \
        node --input-type=module -e '
            import fs from "node:fs";
            const escapeXml = (value) => value
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll("\"", "&quot;")
                .replaceAll("\u0027", "&apos;");
            const status = Number(process.env.TEST_STATUS);
            const failed = status !== 0;
            const phase = process.env.TEST_PHASE;
            const log = fs.existsSync(process.env.TEST_LOG_PATH)
                ? fs.readFileSync(process.env.TEST_LOG_PATH, "utf8")
                : "No output was captured.";
            const bump = (tag, attribute, amount) => tag.replace(
                new RegExp(`${attribute}="(\\d+)"`),
                (_, count) => `${attribute}="${Number(count) + amount}"`,
            );
            let xml = fs.readFileSync(process.env.TEST_OUTPUT_PATH, "utf8");
            xml = xml.replace(/<testsuites\b[^>]*>/, tag => {
                tag = bump(tag, "tests", 1);
                return failed ? bump(tag, "failures", 1) : tag;
            });
            const classname = `kaplay.${process.env.TEST_MODE}.${phase.replaceAll(" ", "-")}`;
            const failure = failed
                ? `      <failure message="${escapeXml(phase)} failed with exit code ${status}">${escapeXml(log)}</failure>\n`
                : "";
            const suite = `  <testsuite name="${escapeXml(classname)}" tests="1" failures="${failed ? 1 : 0}" errors="0" skipped="0" time="0">\n`
                + `    <testcase name="${escapeXml(phase)}" classname="${escapeXml(classname)}" time="0">\n`
                + failure
                + `      <system-out>${escapeXml(log)}</system-out>\n`
                + `    </testcase>\n`
                + `  </testsuite>\n`;
            xml = xml.replace("</testsuites>", () => `${suite}</testsuites>`);
            fs.writeFileSync(process.env.TEST_OUTPUT_PATH, xml);
        '
}

npm run build 2>&1 | tee "$BUILD_LOG"
BUILD_STATUS=${PIPESTATUS[0]}

if [[ $BUILD_STATUS -ne 0 ]]; then
    write_report "$BUILD_STATUS" "build" "$BUILD_LOG"
    rm -f "$BUILD_LOG" "$RUN_LOG" "$TYPE_LOG" "$JUNIT_PATH"
    exit "$BUILD_STATUS"
fi

export PLAYWRIGHT_JUNIT_OUTPUT_FILE="$JUNIT_PATH"

if [[ "$MODE" == "base" ]]; then
    ./node_modules/.bin/playwright test \
        tests/integration/components/missingComps.spec.ts \
        tests/integration/entity/prefab.spec.ts \
        --workers=2 --reporter=junit 2>&1 | tee "$RUN_LOG"
else
    ./node_modules/.bin/playwright test \
        tests/integration/entity/querySubscriptions.82c93d.spec.ts \
        --workers=2 --reporter=junit 2>&1 | tee "$RUN_LOG"
fi
RUN_STATUS=${PIPESTATUS[0]}

if [[ -s "$JUNIT_PATH" ]]; then
    cp "$JUNIT_PATH" "$OUTPUT_PATH"
else
    if [[ $RUN_STATUS -eq 0 ]]; then
        RUN_STATUS=1
    fi
    write_report "$RUN_STATUS" "test runner" "$RUN_LOG"
fi

if [[ $RUN_STATUS -ne 0 ]]; then
    REPORT_STATE=$(TEST_OUTPUT_PATH="$OUTPUT_PATH" node --input-type=module -e '
        import fs from "node:fs";
        const xml = fs.existsSync(process.env.TEST_OUTPUT_PATH)
            ? fs.readFileSync(process.env.TEST_OUTPUT_PATH, "utf8")
            : "";
        if (!xml.includes("</testsuites>")) process.stdout.write("invalid");
        else if (/<(?:failure|error)\b/.test(xml)) process.stdout.write("failure");
        else process.stdout.write("clean");
    ')
    if [[ "$REPORT_STATE" == "clean" ]]; then
        append_result "$RUN_STATUS" "test runner" "$RUN_LOG"
    elif [[ "$REPORT_STATE" == "invalid" ]]; then
        write_report "$RUN_STATUS" "test runner" "$RUN_LOG"
    fi
fi

TYPE_STATUS=0
if [[ "$MODE" == "new" ]]; then
    ./node_modules/.bin/tsc \
        -p tests/query-subscription.82c93d.tsconfig.json \
        2>&1 | tee "$TYPE_LOG"
    TYPE_STATUS=${PIPESTATUS[0]}
    append_result "$TYPE_STATUS" "public API typecheck" "$TYPE_LOG"
else
    append_result 0 "build" "$BUILD_LOG"
fi

rm -f "$BUILD_LOG" "$RUN_LOG" "$TYPE_LOG" "$JUNIT_PATH"

if [[ $RUN_STATUS -ne 0 ]]; then
    exit "$RUN_STATUS"
fi
exit "$TYPE_STATUS"
