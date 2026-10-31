import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const [mode, outputArg] = process.argv.slice(2);

if (!new Set(["base", "new"]).has(mode) || !outputArg) {
    console.error(
        "usage: node tests/run-font-tests.mjs base|new <output-path>",
    );
    process.exit(2);
}

const outputPath = resolve(outputArg);
const playwrightOutput = resolve(
    tmpdir(),
    `kaplay-font-${process.pid}-${Date.now()}.xml`,
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const spawnOptions = {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
};

const buildStarted = Date.now();
const build = spawnSync(npm, ["run", "build"], spawnOptions);
const buildSeconds = (Date.now() - buildStarted) / 1000;
const buildFailed = typeof build.status !== "number" || build.status !== 0;

const specs = mode === "base"
    ? [
        "tests/integration/core",
        "tests/integration/entity",
        "tests/integration/gfx",
    ]
    : ["tests/integration/font-ligatures.1ca293.spec.ts"];
const browser = buildFailed
    ? null
    : spawnSync(
        process.execPath,
        [
            resolve("node_modules/@playwright/test/cli.js"),
            "test",
            ...specs,
            "--reporter=junit",
            "--workers=1",
            "--timeout=90000",
        ],
        {
            ...spawnOptions,
            env: {
                ...process.env,
                PLAYWRIGHT_JUNIT_OUTPUT_FILE: playwrightOutput,
            },
        },
    );

const buildLog = [build.stdout, build.stderr, build.error?.stack]
    .filter(Boolean)
    .join("\n");
const browserLog = [browser?.stdout, browser?.stderr, browser?.error?.stack]
    .filter(Boolean)
    .join("\n");

if (buildLog) process.stdout.write(buildLog);
if (browserLog) process.stdout.write(browserLog);

function xmlChars(value) {
    return String(value).replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
        "",
    );
}

function xmlText(value) {
    return xmlChars(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}

function cdata(value) {
    return xmlChars(value).replaceAll("]]>", "]]]]><![CDATA[>");
}

function statusCode(result) {
    return typeof result.status === "number" ? result.status : 1;
}

const browserStatus = browser ? statusCode(browser) : 0;
const buildSuiteName = `font ${mode} build`;
const browserRunnerSuiteName = `font ${mode} browser runner`;
const buildCase = [
    `<testsuite name="${buildSuiteName}" tests="1" failures="1" errors="0" skipped="0" time="${
        buildSeconds.toFixed(3)
    }">`,
    `<testcase name="npm run build" classname="${buildSuiteName}" time="${
        buildSeconds.toFixed(3)
    }">`,
    `<failure message="build exited with status ${
        xmlText(build.status ?? "unknown")
    }"><![CDATA[${cdata(buildLog)}]]></failure>`,
    buildLog ? `<system-out><![CDATA[${cdata(buildLog)}]]></system-out>` : "",
    "</testcase>",
    "</testsuite>",
].join("\n");

let innerSuites = "";
let browserTests = 1;
let browserFailures = 1;
let browserErrors = 0;
let browserSkipped = 0;
let browserTime = 0;

if (buildFailed) {
    innerSuites = buildCase;
    browserTime = buildSeconds;
}
else if (existsSync(playwrightOutput)) {
    const report = readFileSync(playwrightOutput, "utf8");
    const root = report.match(
        /<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>\s*$/,
    );
    if (root) {
        innerSuites = xmlChars(root[2].trim());
        const attr = name => {
            const match = root[1].match(new RegExp(`${name}="([^"]*)"`));
            return match ? Number(match[1]) : 0;
        };
        browserTests = attr("tests");
        browserFailures = attr("failures");
        browserErrors = attr("errors");
        browserSkipped = attr("skipped");
        browserTime = attr("time");
    }
}

if (!innerSuites && !buildFailed) {
    innerSuites = [
        `<testsuite name="${browserRunnerSuiteName}" tests="1" failures="1" errors="0" skipped="0" time="0">`,
        `<testcase name="playwright execution" classname="${browserRunnerSuiteName}" time="0">`,
        `<failure message="browser test runner did not produce JUnit output"><![CDATA[${
            cdata(browserLog)
        }]]></failure>`,
        "</testcase>",
        "</testsuite>",
    ].join("\n");
}
else if (
    !buildFailed
    && browserStatus !== 0
    && browserFailures === 0
    && browserErrors === 0
) {
    innerSuites += [
        `<testsuite name="${browserRunnerSuiteName}" tests="1" failures="1" errors="0" skipped="0" time="0">`,
        `<testcase name="playwright execution" classname="${browserRunnerSuiteName}" time="0">`,
        `<failure message="browser test runner exited with status ${
            xmlText(browser?.status ?? "unknown")
        }"><![CDATA[${cdata(browserLog)}]]></failure>`,
        "</testcase>",
        "</testsuite>",
    ].join("\n");
    browserTests++;
    browserFailures++;
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
    outputPath,
    [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        `<testsuites name="${mode}" tests="${browserTests}" failures="${browserFailures}" errors="${browserErrors}" skipped="${browserSkipped}" time="${
            (buildFailed ? buildSeconds : browserTime + buildSeconds).toFixed(3)
        }">`,
        innerSuites,
        "</testsuites>",
        "",
    ].join("\n"),
);

rmSync(playwrightOutput, { force: true });
process.exit(
    buildFailed || browserStatus !== 0 || browserFailures > 0
        || browserErrors > 0
        ? 1
        : 0,
);
