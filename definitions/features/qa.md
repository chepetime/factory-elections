# Write the QA plan

Write a QA plan that a human follows to check the finished feature: what automated checks could not prove. Use only the supplied spec, ticket diffs, verification evidence and screenshots. If evidence is missing, say so as an open risk; do not infer that checks passed.

Use these sections:

1. **Set-up**: how to run the app with these changes (branches or PRs, commands, data).
2. **Checks by user story**: numbered steps with the expected result, as a checklist (`- [ ]`).
3. **Edge cases and regressions** worth a human look, from the diffs.
4. **What automation already covered**, from the verification results below, so the human does not repeat it.
5. **Open risks**: assumptions in the spec, runtime checks that could not decide, failed tickets.

Reply with only the Markdown.
