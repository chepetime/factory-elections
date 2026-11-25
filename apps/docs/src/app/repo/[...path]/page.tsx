import { DocsBody, DocsPage } from 'fumadocs-ui/layouts/docs/page';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { Markdown } from 'fumadocs-core/content/md';
import { remarkGfm } from 'fumadocs-core/mdx-plugins';
import { notFound } from 'next/navigation';
import type { ComponentProps } from 'react';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';
import Link from 'fumadocs-core/link';
import { siteHref } from '@/lib/links';
import { listTrackedFolder, readTrackedFile } from '@/lib/repo';

const languages: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  sh: 'sh',
};

function filePath(segments: string[]): string {
  return segments.map(decodeURIComponent).join('/');
}

export default async function RepoFilePage(props: PageProps<'/repo/[...path]'>) {
  const path = filePath((await props.params).path);
  const text = await readTrackedFile(path);
  if (text === null) {
    const children = listTrackedFolder(path);
    if (!children) notFound();
    return (
      <DocsPage>
        <h1 className="text-2xl font-semibold">{path}/</h1>
        <DocsBody>
          <ul>
            {children.map((child) => (
              <li key={child}>
                <Link href={siteHref(`${path}/_`, child)!}>{child}</Link>
              </li>
            ))}
          </ul>
        </DocsBody>
      </DocsPage>
    );
  }

  if (path.endsWith('.md')) {
    const a = (link: ComponentProps<'a'>) => <Link {...link} href={siteHref(path, link.href)} />;
    return (
      <DocsPage>
        <p className="text-sm text-fd-muted-foreground">{path}</p>
        <DocsBody>
          <Markdown remarkPlugins={[remarkGfm]} components={getMDXComponents({ a })}>
            {text}
          </Markdown>
        </DocsBody>
      </DocsPage>
    );
  }

  const extension = path.split('.').pop() ?? '';
  return (
    <DocsPage full>
      <h1 className="text-2xl font-semibold">{path}</h1>
      <DocsBody>
        <DynamicCodeBlock lang={languages[extension] ?? 'text'} code={text} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateMetadata(props: PageProps<'/repo/[...path]'>): Promise<Metadata> {
  return { title: filePath((await props.params).path) };
}
