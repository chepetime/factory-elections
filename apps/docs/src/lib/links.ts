import { posix } from 'node:path';

const external = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

/**
 * Maps a relative link in a repository file to a site URL.
 * `from` is the linking file's path from the repository root.
 * Files under `docs/` become docs pages; other files open under `/repo/`.
 */
export function siteHref(from: string, href: string | undefined): string | undefined {
  if (!href || external.test(href)) return href;
  const hashAt = href.indexOf('#');
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const path = posix.normalize(posix.join(posix.dirname(from), decodeURI(target)));
  if (path.startsWith('..')) return href;
  if (path.startsWith('docs/') && /\.mdx?$/.test(path)) {
    const slug = path
      .slice('docs/'.length)
      .replace(/\.mdx?$/, '')
      .replace(/(^|\/)index$/, '');
    return `/docs${slug ? `/${encodeURI(slug)}` : ''}${hash}`;
  }
  return `/repo/${encodeURI(path.replace(/\/$/, ''))}${hash}`;
}
