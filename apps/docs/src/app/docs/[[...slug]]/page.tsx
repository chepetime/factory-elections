import { source } from '@/lib/source';
import { DocsBody, DocsPage, MarkdownCopyButton } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { ComponentProps } from 'react';

// The docs use bare relative links (`local-backend.md`). Fumadocs resolves
// file links only when they start with `./` or `../`.
function fileHref(href: string | undefined): string | undefined {
  if (!href || /^([a-z][a-z0-9+.-]*:|\/|#|\.)/i.test(href)) return href;
  return `./${href}`;
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const RelativeLink = createRelativeLink(source, page);
  const a = (props: ComponentProps<'a'>) => <RelativeLink {...props} href={fileHref(props.href)} />;

  // The Markdown body carries its own `# ` title, so the page renders no
  // separate title, and the table of contents skips that heading.
  return (
    <DocsPage toc={page.data.toc.filter((item) => item.depth > 1)} full={page.data.full}>
      <div className="flex flex-row justify-end">
        <MarkdownCopyButton markdownUrl={`${page.url}.md`} />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents({ a })} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return { title: page.data.title, description: page.data.description };
}
