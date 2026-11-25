import { source } from '@/lib/source';
import { DocsBody, DocsPage, MarkdownCopyButton } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import type { ComponentProps } from 'react';
import Link from 'fumadocs-core/link';
import { siteHref } from '@/lib/links';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // Links stay relative file paths in the Markdown, so agents can follow them too.
  const a = (props: ComponentProps<'a'>) => (
    <Link {...props} href={siteHref(`docs/${page.path}`, props.href)} />
  );

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
