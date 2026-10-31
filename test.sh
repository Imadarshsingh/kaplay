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
CHECK_LOG_PATH="$(mktemp)"
BUILD_LOG_PATH="$(mktemp)"
RUN_LOG_PATH="$(mktemp)"
JUNIT_PATH="$(mktemp)"
rm -f "$JUNIT_PATH"

CHECK_STATUS=0
if [[ "$MODE" == "base" ]]; then
    ./node_modules/.bin/tsc --noEmit 2>&1 | tee "$CHECK_LOG_PATH"
else
    ./node_modules/.bin/tsc --noEmit \
        --project tests/tsconfig.debug-console-9c6d2a.json \
        2>&1 | tee "$CHECK_LOG_PATH"
fi
CHECK_STATUS=${PIPESTATUS[0]}

npm run build 2>&1 | tee "$BUILD_LOG_PATH"
BUILD_STATUS=${PIPESTATUS[0]}

RUN_STATUS=0
if [[ $BUILD_STATUS -eq 0 ]]; then
    export PLAYWRIGHT_JUNIT_OUTPUT_FILE="$JUNIT_PATH"
    if [[ "$MODE" == "base" ]]; then
        ./node_modules/.bin/playwright test \
            tests/integration/components/missingComps.spec.ts \
            tests/integration/components/wait.spec.ts \
            tests/integration/core/plugin.spec.ts \
            tests/integration/core/VERSION.spec.ts \
            tests/integration/entity/prefab.spec.ts \
            tests/integration/gfx/textureSync.spec.ts \
            --workers=1 --timeout=120000 --reporter=junit \
            2>&1 | tee "$RUN_LOG_PATH"
    else
        ./node_modules/.bin/playwright test \
            tests/integration/debugConsole.9c6d2a.spec.ts \
            --workers=1 --timeout=120000 --reporter=junit \
            2>&1 | tee "$RUN_LOG_PATH"
    fi
    RUN_STATUS=${PIPESTATUS[0]}
fi

TEST_MODE="$MODE" \
TEST_CHECK_STATUS="$CHECK_STATUS" \
TEST_BUILD_STATUS="$BUILD_STATUS" \
TEST_RUN_STATUS="$RUN_STATUS" \
TEST_CHECK_LOG="$CHECK_LOG_PATH" \
TEST_BUILD_LOG="$BUILD_LOG_PATH" \
TEST_RUN_LOG="$RUN_LOG_PATH" \
TEST_JUNIT_PATH="$JUNIT_PATH" \
TEST_OUTPUT_PATH="$OUTPUT_PATH" \
node --input-type=module -e '
    import fs from "node:fs";

    const escapeXml = (value) => value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("\u0027", "&apos;");

    const mode = process.env.TEST_MODE;
    const checkStatus = Number(process.env.TEST_CHECK_STATUS);
    const buildStatus = Number(process.env.TEST_BUILD_STATUS);
    const runStatus = Number(process.env.TEST_RUN_STATUS);
    const read = (path) => fs.existsSync(path)
        ? fs.readFileSync(path, "utf8")
        : "No output was captured.";
    const checkLog = read(process.env.TEST_CHECK_LOG);
    const buildLog = read(process.env.TEST_BUILD_LOG);
    const runLog = read(process.env.TEST_RUN_LOG);
    const hasJunit = fs.existsSync(process.env.TEST_JUNIT_PATH)
        && fs.statSync(process.env.TEST_JUNIT_PATH).size > 0;

    let junit = hasJunit
        ? fs.readFileSync(process.env.TEST_JUNIT_PATH, "utf8")
        : "";
    const junitHasFailures = hasJunit
        && /<(failure|error)\b/.test(junit);
    const inconsistentRunner = hasJunit
        && ((runStatus === 0 && junitHasFailures)
            || (runStatus !== 0 && !junitHasFailures));
    const pipelineFailed = checkStatus !== 0
        || buildStatus !== 0
        || !hasJunit
        || inconsistentRunner;

    const sections = [
        `TYPECHECK (exit ${checkStatus})\n${checkLog}`,
        `BUILD (exit ${buildStatus})\n${buildLog}`,
    ];
    if (buildStatus === 0) {
        sections.push(`TEST RUNNER (exit ${runStatus})\n${runLog}`);
    }
    const pipelineLog = sections.join("\n\n");
    const pipelineName = `${mode} verification pipeline`;
    const failure = pipelineFailed
        ? `      <failure message="${escapeXml(pipelineName + " failed")}">${escapeXml(pipelineLog)}</failure>\n`
        : "";
    const pipelineSuite = `  <testsuite name="kaplay.${mode}.pipeline" tests="1" failures="${pipelineFailed ? 1 : 0}" errors="0" skipped="0" time="0">\n`
        + `    <testcase name="${escapeXml(pipelineName)}" classname="kaplay.${mode}.pipeline" time="0">\n`
        + failure
        + `      <system-out>${escapeXml(pipelineLog)}</system-out>\n`
        + `    </testcase>\n`
        + `  </testsuite>\n`;

    if (hasJunit) {
        const bump = (tag, attribute, amount) => tag.replace(
            new RegExp(`${attribute}="(\\d+)"`),
            (_, count) => `${attribute}="${Number(count) + amount}"`,
        );
        junit = junit.replace(
            /<testsuites\b[^>]*>/,
            (tag) => bump(
                bump(tag, "tests", 1),
                "failures",
                pipelineFailed ? 1 : 0,
            ),
        );
        junit = junit.replace("</testsuites>", `${pipelineSuite}</testsuites>`);
    }
    else {
        junit = `<?xml version="1.0" encoding="UTF-8"?>\n`
            + `<testsuites name="kaplay" tests="1" failures="1" errors="0" skipped="0" time="0">\n`
            + pipelineSuite
            + `</testsuites>\n`;
    }

    fs.writeFileSync(process.env.TEST_OUTPUT_PATH, junit);
'
JUNIT_STATUS=$?

FINAL_STATUS=0
if [[ $CHECK_STATUS -ne 0 || $BUILD_STATUS -ne 0 || $RUN_STATUS -ne 0 || $JUNIT_STATUS -ne 0 ]]; then
    FINAL_STATUS=1
fi

rm -f "$CHECK_LOG_PATH" "$BUILD_LOG_PATH" "$RUN_LOG_PATH" "$JUNIT_PATH"
exit "$FINAL_STATUS"
