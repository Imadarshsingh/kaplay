#!/usr/bin/env bash

set -u

output_path=""
mode=""

while (($#)); do
    case "$1" in
        --output_path)
            if (($# < 2)); then
                echo "--output_path requires a path" >&2
                exit 2
            fi
            output_path="$2"
            shift 2
            ;;
        base|new)
            if [[ -n "$mode" ]]; then
                echo "only one mode may be selected" >&2
                exit 2
            fi
            mode="$1"
            shift
            ;;
        *)
            echo "unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$output_path" || -z "$mode" ]]; then
    echo "usage: ./test.sh --output_path <path> base|new" >&2
    exit 2
fi

node tests/run-font-tests.mjs "$mode" "$output_path"
