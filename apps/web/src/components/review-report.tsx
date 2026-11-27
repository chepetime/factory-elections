'use client';
// The senior-pr-review report, rendered from the payload the review agent saves. Order follows the
// skill: verdict, problem, proof, blockers, suggestions, coverage, post-merge signal, residual risks.
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ReviewPayload } from '@/lib/reviews';
import { cn } from '@factory/ui/lib/utils';

type Finding = ReviewPayload['findings'][number];

const SEVERITY: Record<string, { label: string; tone: string }> = {
  critical: { label: 'Critical', tone: 'bg-destructive/15 text-destructive' },
  'must-fix': { label: 'Must fix', tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  'should-fix': { label: 'Should fix', tone: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
};
const DECISION_TONE: Record<string, string> = {
  Approve: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Comment: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  'Request changes': 'bg-destructive/15 text-destructive',
  'Needs discussion': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  'Needs attention': 'bg-destructive/15 text-destructive',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy comment'}
    </button>
  );
}

function List({ items }: { items: (string | null | undefined)[] | null | undefined }) {
  const shown = (items ?? []).filter((x): x is string => Boolean(x?.trim()));
  if (!shown.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {shown.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function FindingCard({ finding, id }: { finding: Finding; id: string }) {
  const severity = SEVERITY[finding.severity ?? ''] ?? {
    label: finding.severity ?? 'Finding',
    tone: 'bg-muted',
  };
  const location = finding.file
    ? `${finding.file}${finding.line_range ? `:${finding.line_range}` : ''}`
    : undefined;
  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', severity.tone)}>
          {severity.label}
        </span>
        {finding.axis && <span className="text-xs text-muted-foreground">{finding.axis}</span>}
        <div className="ml-auto">{finding.comment && <CopyButton text={finding.comment} />}</div>
      </div>
      <h3 className="mt-2 font-medium">{finding.title}</h3>
      {location && <p className="mt-0.5 font-mono text-xs break-all text-muted-foreground">{location}</p>}
      <div className="mt-3 flex flex-col gap-2 text-sm">
        {finding.impact && (
          <p>
            <span className="font-medium">Impact.</span> {finding.impact}
          </p>
        )}
        {finding.explanation && <p>{finding.explanation}</p>}
        {finding.fix && (
          <p>
            <span className="font-medium">Fix.</span> {finding.fix}
          </p>
        )}
        {finding.evidence && finding.evidence.length > 0 && (
          <ul className="list-disc pl-5 font-mono text-xs text-muted-foreground">
            {finding.evidence.map((e, i) => (
              <li key={i} className="break-all">
                {e}
              </li>
            ))}
          </ul>
        )}
        {finding.comment && (
          <blockquote className="rounded-lg border-l-2 bg-muted/40 px-3 py-2 text-sm">
            {finding.comment}
          </blockquote>
        )}
      </div>
    </article>
  );
}

export function ReviewReport({ payload }: { payload: ReviewPayload }) {
  const m = payload.meta;
  const blockers = payload.findings.filter((f) => f.severity === 'critical' || f.severity === 'must-fix');
  const suggestions = payload.findings.filter((f) => f.severity !== 'critical' && f.severity !== 'must-fix');
  const id = (f: Finding) => `f-${payload.findings.indexOf(f)}`;
  const facts = (
    [
      ['Risk', m.risk_level ? `${m.risk_level}${m.risk_reason ? `: ${m.risk_reason}` : ''}` : undefined],
      [
        'Size',
        m.size?.lines != null
          ? `${m.size.lines} lines, ${m.size.files ?? m.files_changed ?? '?'} files`
          : undefined,
      ],
      ['Confidence', m.confidence],
      ['Ticket', m.jira_key ? `${m.jira_key}${m.jira_summary ? `: ${m.jira_summary}` : ''}` : undefined],
      ['Base', m.base],
      ['Skill', m.skill_version],
    ] as [string, string | null | undefined][]
  ).filter((f): f is [string, string] => Boolean(f[1]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {m.decision && (
            <span
              className={cn(
                'rounded-lg px-2.5 py-1 text-sm font-semibold',
                DECISION_TONE[m.decision] ?? 'bg-muted',
              )}
            >
              {m.decision}
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            {blockers.length} blocking · {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
          </span>
        </div>
        {m.summary && <p className="text-sm leading-6">{m.summary}</p>}
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
        {m.needs_confirmation && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Needs owner confirmation.</span> {m.needs_confirmation}
          </p>
        )}
      </header>

      {(m.problem || m.solution || m.problem_signal?.mismatch) && (
        <Section title="Problem">
          {m.problem && <p className="text-sm">{m.problem}</p>}
          {m.solution && <p className="text-sm text-muted-foreground">{m.solution}</p>}
          {m.problem_signal?.mismatch && (
            <p className="text-sm text-destructive">{m.problem_signal.mismatch}</p>
          )}
          {m.problem_fit?.verdict && (
            <p className="text-sm">
              <span className="font-medium">Fit: {m.problem_fit.verdict}.</span> {m.problem_fit.evidence}
            </p>
          )}
        </Section>
      )}

      {m.proof && (
        <Section title="Proof">
          {m.proof.tests_on_base && m.proof.tests_on_base.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Test</th>
                    <th className="px-3 py-1.5 font-medium">Base</th>
                    <th className="px-3 py-1.5 font-medium">Head</th>
                  </tr>
                </thead>
                <tbody>
                  {m.proof.tests_on_base.map((t, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs break-all">
                        {t.test}
                        {t.note && <span className="block font-sans text-muted-foreground">{t.note}</span>}
                      </td>
                      <td className="px-3 py-1.5">{t.base}</td>
                      <td className="px-3 py-1.5">{t.head}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {[
            ['Reproduction', m.proof.reproduction],
            ['Diff coverage', m.proof.diff_coverage],
            ['Mutation', m.proof.mutation],
            ['CI', m.proof.ci],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <p key={k} className="text-sm">
                <span className="font-medium">{k}.</span> {v}
              </p>
            ))}
        </Section>
      )}

      <Section title="Blocking">
        {blockers.length ? (
          blockers.map((f) => <FindingCard key={id(f)} finding={f} id={id(f)} />)
        ) : (
          <p className="text-sm text-muted-foreground">No blocking issues.</p>
        )}
      </Section>

      {suggestions.length > 0 && (
        <Section title="Suggestions">
          {suggestions.map((f) => (
            <FindingCard key={id(f)} finding={f} id={id(f)} />
          ))}
        </Section>
      )}

      {payload.open_questions && payload.open_questions.length > 0 && (
        <Section title="Open question">
          {payload.open_questions.map((q, i) => (
            <article key={i} className="rounded-xl border bg-card p-4 text-sm">
              <p className="font-mono text-xs text-muted-foreground">q-{i}</p>
              <h3 className="mt-1 font-medium">{q.title}</h3>
              <p className="mt-1">{q.explanation}</p>
            </article>
          ))}
        </Section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Section title="Verified">
          <List items={m.verified} />
        </Section>
        <Section title="Not verified">
          <List items={m.not_verified} />
        </Section>
      </div>

      {m.post_merge_signal && (
        <Section title="Post-merge signal">
          <p className="text-sm">{m.post_merge_signal}</p>
        </Section>
      )}

      {m.residual_risks && m.residual_risks.length > 0 && (
        <Section title="Residual risks">
          <List items={m.residual_risks.map((r) => (r.tag ? `${r.tag}: ${r.text ?? ''}` : r.text))} />
        </Section>
      )}

      {m.review_note && (
        <Section title="Review note for the author">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm">{m.review_note}</p>
            <CopyButton text={m.review_note} />
          </div>
        </Section>
      )}
    </div>
  );
}
