import { ArrowUpRight } from 'lucide-react';
import support from '../../../../resources/frontend-component-support.json';
import { Badge } from '@/components/ui/badge';

export function ComponentSupport() {
  const implemented = support.items.filter((item) => item.status === 'implemented').length;
  const available = support.items.filter((item) => item.status === 'available').length;
  return (
    <section id="support-roadmap" aria-labelledby="support-heading" className="scroll-mt-6 space-y-4">
      <div className="space-y-2">
        <h2 id="support-heading" className="text-xl font-semibold tracking-tight">
          Component support roadmap
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The {support.items.length} items from the original reference list. {implemented} original
          implementations, {available} free module already available, and{' '}
          {support.items.length - implemented - available} planned. Implemented components currently use demo
          data.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">
            Support status for the original frontend component reference list
          </caption>
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Component
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Preview
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Reference
              </th>
            </tr>
          </thead>
          <tbody>
            {support.items.map((item) => (
              <tr key={item.name} className="border-b last:border-b-0">
                <th scope="row" className="px-4 py-2 font-medium">
                  {item.name}
                  {item.kind === 'screen' && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">Screen</span>
                  )}
                </th>
                <td className="px-4 py-2">
                  <Badge variant={item.status === 'planned' ? 'outline' : 'secondary'}>
                    {item.status === 'implemented'
                      ? 'Implemented'
                      : item.status === 'available'
                        ? 'Free source'
                        : 'Planned'}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {item.storybookId ? (
                    <a
                      href={`http://127.0.0.1:6006/?path=/story/${item.storybookId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-xs underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Storybook
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                      <span className="sr-only"> for {item.name}</span>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not started</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <a
                    href={item.reference}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Public reference
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                    <span className="sr-only"> for {item.name}</span>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
