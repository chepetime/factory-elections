#!/usr/bin/env python3
"""Report test coverage on the lines a PR changed.

Reads one or more lcov files and the diff between the merge-base of BASE and
HEAD, and prints covered / executable changed lines per file and in total,
with the uncovered line numbers. Changed code files that no lcov file
instruments are listed as "not instrumented".

Usage:
    diff_coverage.py --base origin/development --lcov apps/api/coverage/lcov.info [--lcov ...] [--json]

lcov SF paths may be absolute, repo-relative, or relative to the package that
owns the coverage directory (vitest's default); all three resolve.
"""

import argparse
import json
import os
import re
import subprocess
import sys

CODE_RE = re.compile(r"\.(c|m)?[jt]sx?$|\.py$|\.go$")
TEST_RE = re.compile(r"(^|/)(__tests__|__mocks__|__fixtures__|fixtures|tests?)/|\.(spec|test)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.(py|go)$")
GENERATED_RE = re.compile(r"(^|/)(@generated|generated|dist|build)/|\.gen\.|\.d\.ts$")


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def changed_lines(merge_base):
    out = git("diff", "-U0", "--no-color", merge_base, "HEAD")
    lines, current = {}, None
    for row in out.splitlines():
        if row.startswith("+++ "):
            path = row[4:]
            current = None if path == "/dev/null" else path[2:] if path.startswith("b/") else path
            if current:
                lines.setdefault(current, set())
        elif row.startswith("@@") and current:
            m = re.search(r"\+(\d+)(?:,(\d+))?", row)
            start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            lines[current].update(range(start, start + count))
    return {p: ls for p, ls in lines.items() if ls}


def parse_lcov(path, root):
    pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    cov_dir = os.path.dirname(os.path.abspath(path))
    hits, current = {}, None
    with open(path, encoding="utf-8") as fh:
        for row in fh:
            row = row.strip()
            if row.startswith("SF:"):
                sf = row[3:]
                candidates = [sf] if os.path.isabs(sf) else [
                    os.path.join(root, sf), os.path.join(pkg_dir, sf), os.path.join(cov_dir, sf)]
                found = next((c for c in candidates if os.path.exists(c)), candidates[0])
                current = os.path.relpath(os.path.realpath(found), root)
                hits.setdefault(current, {})
            elif row.startswith("DA:") and current:
                line, count = row[3:].split(",")[:2]
                n = int(line)
                hits[current][n] = max(hits[current].get(n, 0), int(float(count)))
            elif row == "end_of_record":
                current = None
    return hits


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--lcov", action="append", required=True)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = os.path.realpath(git("rev-parse", "--show-toplevel").strip())
    os.chdir(root)
    merge_base = git("merge-base", args.base, "HEAD").strip()
    changed = changed_lines(merge_base)

    coverage = {}
    for path in args.lcov:
        for f, da in parse_lcov(path, root).items():
            merged = coverage.setdefault(f, {})
            for n, c in da.items():
                merged[n] = max(merged.get(n, 0), c)

    files, not_instrumented = [], []
    total_exec = total_cov = 0
    for f, lines in sorted(changed.items()):
        if not CODE_RE.search(f) or TEST_RE.search(f) or GENERATED_RE.search(f):
            continue
        if f not in coverage:
            not_instrumented.append(f)
            continue
        exec_lines = sorted(n for n in lines if n in coverage[f])
        covered = [n for n in exec_lines if coverage[f][n] > 0]
        uncovered = [n for n in exec_lines if coverage[f][n] == 0]
        total_exec += len(exec_lines)
        total_cov += len(covered)
        files.append({"file": f, "executable": len(exec_lines), "covered": len(covered), "uncovered": uncovered})

    pct = round(100 * total_cov / total_exec, 1) if total_exec else None
    result = {"covered": total_cov, "executable": total_exec, "percent": pct,
              "files": files, "not_instrumented": not_instrumented}
    if args.json:
        print(json.dumps(result, indent=2))
        return 0
    for row in files:
        miss = f"  uncovered: {','.join(map(str, row['uncovered']))}" if row["uncovered"] else ""
        print(f"{row['covered']}/{row['executable']}\t{row['file']}{miss}")
    for f in not_instrumented:
        print(f"-\t{f}  not instrumented")
    print(f"TOTAL {total_cov}/{total_exec} changed executable lines covered"
          + (f" ({pct}%)" if pct is not None else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
