// Storybook stand-in for next/link: Next's Link needs the Next runtime. Renders a plain anchor.
import type { AnchorHTMLAttributes } from 'react';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string };
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, prefetch: _p, replace: _r, scroll: _s, ...rest }: Props) {
  return <a href={typeof href === 'string' ? href : (href.pathname ?? '')} {...rest} />;
}
