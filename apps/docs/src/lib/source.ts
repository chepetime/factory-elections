import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { docsRoute } from './shared';

// The repository `docs/` folder is the single source. Agents read the same
// Markdown files, so pages carry no required frontmatter: the title falls back
// to the first `# ` heading of the file.
function firstHeading(source: string): string | undefined {
  return /^#\s+(.+?)\s*$/m.exec(source)?.[1];
}

const docs = defineDocs({
  dir: '../../docs',
  docs: {
    schema: ({ path, source }) =>
      pageSchema.extend({
        title: pageSchema.shape.title.default(
          firstHeading(source) ??
            path
              .split('/')
              .pop()!
              .replace(/\.mdx?$/, ''),
        ),
      }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

// The body already starts with its `# ` title.
export const docsLlms = llms(source, {
  renderPage: async (page) => page.data.getText('processed'),
});
