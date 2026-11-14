import Link from 'next/link';
import placeholders from '../../../../resources/frontend-component-placeholders.json';
import { EngineHealthPanel } from '@/components/engine-health-panel';
import { ProjectSelector } from '@/components/project-selector';

export const dynamic = 'force-dynamic';

const CONTRACTS = [
  ['Task record', 'resources/task-record.schema.json'],
  ['Classifier verdict', 'resources/classifier-verdict.schema.json'],
  ['Review', 'resources/review.schema.json'],
  ['Project', 'resources/project.schema.json'],
  ['Task and project read APIs', 'resources/*-read-api.openapi.yaml'],
  ['Engine health', 'resources/engine-health.openapi.yaml'],
] as const;

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Software Factory</h1>
        <nav aria-label="Sections" className="flex gap-4 text-sm">
          <a href="#projects" className="underline-offset-4 hover:underline">
            Projects
          </a>
          <Link href="/components" className="underline-offset-4 hover:underline">
            Components
          </Link>
          <a href="#data-contracts" className="underline-offset-4 hover:underline">
            Data contracts
          </a>
        </nav>
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section id="projects" aria-labelledby="projects-heading" className="rounded-xl border p-4">
          <h2 id="projects-heading" className="mb-3 font-medium">
            Projects
          </h2>
          <ProjectSelector />
        </section>
        <EngineHealthPanel />
      </div>

      <section id="components" aria-labelledby="components-heading">
        <h2 id="components-heading" className="mb-1 font-medium">
          Components
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Planned views. None of these are connected yet; the working views are under each project.
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {(placeholders as string[]).map((name) => (
            <li key={name} className="rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">Not connected</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="data-contracts" aria-labelledby="contracts-heading">
        <h2 id="contracts-heading" className="mb-1 font-medium">
          Data contracts
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Every view reads and acts through the local factory CLI; the web app keeps no state.
        </p>
        <ul className="text-sm">
          {CONTRACTS.map(([name, file]) => (
            <li key={name}>
              {name} — <code className="text-xs">{file}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
