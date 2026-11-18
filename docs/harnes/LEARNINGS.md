# Harness learnings

Keep this directory name (`harnes`) stable for existing task links. Record experiments as `LEARNING_NN_TOPIC.md`; link results here after checking their evidence.

- [01: Token optimization](LEARNING_01_TOKEN_OPTIMIZATION.md): compact task routing, bounded output, source adaptations and a reproducible measurement protocol.
- [02: Worktrees and CI](LEARNING_02_WORKTREES_AND_CI.md): isolation fixes, dependency selection and observed validation.

For each experiment record the revision, task, model, enabled tools/skills, input/cache/output tokens, checks passed, elapsed time and limitations. Separate observed measurements from hypotheses. Include failed tasks and retries; reduced cost with reduced task success is not a win. Never commit raw sessions containing credentials or private task content.

Promote a recurring discovery into the relevant task guide after repeated evidence confirms it. Remove or correct it when the repository changes. Keep the root router small; experiment history belongs here, not in always-loaded instructions.
