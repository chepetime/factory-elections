// The pull request template: the repository's own when it has one, else the factory's. The PR
// writer must keep every heading of it, and the factory checks that before it uses a body.

/** Where a repository may keep its PR template, in the order GitHub looks. */
export const PR_TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
] as const;

/** The factory's template, for a repository without its own. */
export const FACTORY_PR_TEMPLATE = `## Summary

<one or two sentences, then the smallest visual that makes the change clear>

## Evidence

- **Before:** <what was true or failing before>
  **After:** <what is true or passing now>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <one word>
`;

export interface PrTemplate {
  /** The repository path it came from, or `factory`. */
  source: string;
  text: string;
}

const normal = (heading: string) => heading.trim().replace(/\s+/g, ' ').toLowerCase();

/** The template's Markdown headings, in order, without HTML comments and fenced code. */
export function templateHeadings(template: string): string[] {
  const text = template.replace(/<!--[\s\S]*?-->/g, '').replace(/^```[\s\S]*?^```/gm, '');
  return [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)].map((m) => m[1]!.trim());
}

/** The template headings the body does not have as headings of its own. */
export function missingHeadings(body: string, template: string): string[] {
  const present = new Set(templateHeadings(body).map(normal));
  return templateHeadings(template).filter((heading) => !present.has(normal(heading)));
}

/**
 * A body in the template's shape when no writer draft exists: the task under the first heading,
 * and a plain note under the others, so even a fallback PR keeps the template.
 */
export function templateFallback(template: string, task: string): string {
  const headings = templateHeadings(template);
  if (!headings.length) return task;
  return headings
    .map((heading, i) =>
      i === 0
        ? `## ${heading}\n\n${task}`
        : `## ${heading}\n\n_Not written: the PR writer did not draft this section. See the factory record below._`,
    )
    .join('\n\n');
}
