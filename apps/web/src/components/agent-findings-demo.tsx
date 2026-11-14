'use client';

import { useState } from 'react';
import { Braces, Check, FlaskConical, Play, RotateCcw, ShieldCheck, X, Zap } from 'lucide-react';
import { AgentFindings, type Finding, type FindingAgent } from '@/components/agent-findings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const AGENTS: FindingAgent[] = [
  {
    id: 'security',
    name: 'Security',
    model: 'Code review',
    avatar: <ShieldCheck className="text-violet-500" />,
    step: 'Checking API authorization',
    done: 5,
    total: 24,
  },
  {
    id: 'tests',
    name: 'Test runner',
    model: 'Validation',
    avatar: <FlaskConical className="text-blue-500" />,
    step: 'Exercising task transitions',
    done: 4,
    total: 18,
  },
  {
    id: 'types',
    name: 'Type checker',
    model: 'Static analysis',
    avatar: <Braces className="text-emerald-600" />,
    step: 'Inspecting shared contracts',
    done: 2,
    total: 12,
  },
  {
    id: 'performance',
    name: 'Performance',
    model: 'Profiling',
    avatar: <Zap className="text-amber-600" />,
    step: 'Measuring project queries',
    done: 3,
    total: 10,
  },
];

const FINDINGS: (Finding & { detail: string; round: number })[] = [
  {
    id: 'query',
    agentId: 'performance',
    title: 'Project list repeats the same query',
    severity: 'note',
    location: 'projects.ts:42',
    at: 14_000,
    round: 0,
    detail:
      'The sample review found repeated reads for the project list. Reuse the result within the request to reduce unnecessary work.',
  },
  {
    id: 'access',
    agentId: 'security',
    title: 'Task endpoint needs an ownership check',
    severity: 'critical',
    location: 'tasks/route.ts:28',
    at: 48_000,
    round: 0,
    detail:
      'This sample endpoint accepts a task identifier before checking its project owner. Verify ownership before reading or changing the task.',
  },
  {
    id: 'retry',
    agentId: 'tests',
    title: 'Retry path has no regression coverage',
    severity: 'warning',
    location: 'tasks.test.ts:96',
    at: 60_000,
    round: 0,
    detail:
      'The simulated test review found coverage for successful runs but no check for retrying a failed task. Add a regression case that verifies the previous attempt is preserved.',
  },
  {
    id: 'contract',
    agentId: 'types',
    title: 'Task status is wider than its contract',
    severity: 'warning',
    location: 'task-record.ts:17',
    at: 75_000,
    round: 1,
    detail:
      'A sample response uses a plain string for task status. Derive the type from the schema so unsupported states are caught before runtime.',
  },
  {
    id: 'pagination',
    agentId: 'performance',
    title: 'Large task lists need pagination',
    severity: 'note',
    location: 'projects.ts:81',
    at: 90_000,
    round: 2,
    detail:
      'The demo profiler observed a query returning every task. A bounded page size would keep response time predictable as the project grows.',
  },
  {
    id: 'timeout',
    agentId: 'tests',
    title: 'Timeout cleanup leaves a pending listener',
    severity: 'warning',
    location: 'process.test.ts:124',
    at: 105_000,
    round: 3,
    detail:
      'The simulated run detected an abort listener surviving a completed request. Remove it when the request settles and verify timeout cleanup.',
  },
];

export function AgentFindingsDemo() {
  const [round, setRound] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const complete = round === 4;
  const agents = AGENTS.map((agent) => ({
    ...agent,
    done: complete ? agent.total : Math.min(agent.total, agent.done + round * 4),
  }));
  const findings = FINDINGS.filter((finding) => finding.round <= round);
  const opened = findings.find((finding) => finding.id === openedId);

  return (
    <div className="space-y-5">
      <AgentFindings
        key={resetVersion}
        agents={agents}
        findings={findings}
        now={60_000 + round * 15_000}
        onOpen={(finding) => setOpenedId(finding.id)}
      />
      {opened && (
        <Card
          role="region"
          aria-label="Finding details"
          className="gap-3 border-l-2 border-l-blue-500 px-5 shadow-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Badge
                variant={opened.severity === 'critical' ? 'destructive' : 'secondary'}
                className="capitalize"
              >
                {opened.severity}
              </Badge>
              <h4 className="text-sm font-medium">{opened.title}</h4>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Close finding details"
              onClick={() => setOpenedId(null)}
            >
              <X />
            </Button>
          </div>
          <code className="text-xs text-muted-foreground">{opened.location}</code>
          <p className="text-sm leading-relaxed text-muted-foreground">{opened.detail}</p>
        </Card>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {complete
            ? 'Review complete. Select an agent to filter, or open a finding for details.'
            : 'Select an agent to filter its findings. Run the next checks to see new results.'}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setRound(0);
              setResetVersion((value) => value + 1);
              setOpenedId(null);
            }}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button
            className="min-h-11"
            disabled={complete}
            onClick={() => setRound((value) => Math.min(4, value + 1))}
          >
            {complete ? <Check /> : <Play />}
            {complete ? 'Review complete' : 'Run next checks'}
          </Button>
        </div>
      </div>
    </div>
  );
}
