# Lens: False-positive patterns

Drop these before publishing, in any repo:

Drop these before publishing:

- Pre-existing issues out of scope — unchanged by this diff, no more reachable, no larger blast radius. (An issue the diff made *reachable* is in scope.)
- Linter / typechecker complaints
- Pure style nitpicks not codified in CLAUDE.md or neighbor files
- "You could split this into two files" without a concrete reason
- Speculative future-proofing ("what if someone adds another variant")
- Demanding tests for trivial changes (typos, doc-only edits, dependency bumps)
- Reuse suggestions that only share a name, not behavior
- Convention complaints that contradict what the surrounding files actually do
- Findings about generated files
