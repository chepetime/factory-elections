import type { Meta, StoryObj } from '@storybook/react-vite';
import { Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { CallChip, iconForTool, type CallStatus } from '@/components/bits/call-chip';
import { DESTRUCTIVE_HOLD, HoldButton } from '@/components/bits/hold-button';
import { LatticeLoader } from '@/components/bits/lattice-loader';
import { SpecularButton } from '@/components/bits/specular-button';
import { ThoughtLine } from '@/components/bits/thought-line';

// The React Bits ports with the props the app uses, so their states are visible without a live run.
const meta = {
  title: 'Factory/Bits',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const CHIP = {
  size: 24,
  radius: 6,
  surfaceColor: 'transparent',
  doneColor: 'var(--chip-done)',
  errorColor: 'var(--destructive)',
  shake: 4,
  className: 'min-w-0 [--chip-done:#059669] dark:[--chip-done:#34d399]',
} as const;

/** A call that runs for a while, then ends as `end`. */
function CyclingChip({ name, argument, end }: { name: string; argument: string; end: CallStatus }) {
  const [status, setStatus] = useState<CallStatus>('running');
  useEffect(() => {
    const timer = setInterval(() => setStatus((s) => (s === 'running' ? end : 'running')), 2400);
    return () => clearInterval(timer);
  }, [end]);
  return <CallChip {...CHIP} icon={iconForTool(name)} name={name} argument={argument} status={status} />;
}

export const ToolCalls: Story = {
  render: () => (
    <ul className="flex max-w-md flex-col gap-1 text-xs">
      <li>
        <CallChip
          {...CHIP}
          icon="file"
          name="Read"
          argument="apps/web/src/app/page.tsx"
          status="done"
          durationMs={42}
        />
      </li>
      <li>
        <CallChip
          {...CHIP}
          icon="terminal"
          name="Bash"
          argument="pnpm --filter @factory/web exec vitest run --project unit test/task-page.test.tsx"
          status="error"
          durationMs={8312}
        />
      </li>
      <li>
        <CyclingChip name="Grep" argument="LoaderCircle apps/web/src" end="done" />
      </li>
      <li>
        <CyclingChip name="Bash" argument="pnpm typecheck" end="error" />
      </li>
    </ul>
  ),
};

export const Thinking: Story = {
  render: function Render() {
    const [working, setWorking] = useState(true);
    const [steps, setSteps] = useState(['$ pnpm install --frozen-lockfile']);
    useEffect(() => {
      if (!working) return;
      const more = ['$ pnpm typecheck', '$ pnpm test', 'Writing the summary'];
      const timer = setInterval(() => {
        const next = more.shift();
        if (next) setSteps((s) => [...s, next]);
        else setWorking(false);
      }, 1500);
      return () => clearInterval(timer);
    }, [working]);
    return (
      <div className="flex max-w-md flex-col gap-6 text-muted-foreground">
        <ThoughtLine
          label="Coding"
          steps={steps}
          working={working}
          fontSize={14}
          className="[&_li]:font-mono [&_li]:text-xs"
        />
        <ThoughtLine label="Ada is replying…" doneLabel="Replied in" collapsible={false} fontSize={13} />
        <button type="button" className="self-start text-xs underline" onClick={() => setWorking((w) => !w)}>
          Toggle working
        </button>
      </div>
    );
  },
};

export const Loaders: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-muted-foreground">
      <LatticeLoader label="Checking…" fontSize={13} />
      <LatticeLoader status="done" doneLabel="Checked in" fontSize={13} />
      <LatticeLoader status="error" errorLabel="Failed after" fontSize={13} />
      <LatticeLoader label="Loading tickets…" showTimer={false} />
    </div>
  ),
};

export const HoldToConfirm: StoryObj<{ onHold: () => void }> = {
  args: { onHold: fn() },
  render: (args) => (
    <div className="flex items-center gap-4">
      <HoldButton {...DESTRUCTIVE_HOLD} holdTime={300} doneLabel="Removing…" onHold={args.onHold}>
        <Trash2 aria-hidden /> Hold to remove review
      </HoldButton>
      <HoldButton
        size="icon"
        radius={999}
        fillDirection="up"
        holdTime={800}
        backgroundColor="color-mix(in srgb, var(--destructive) 14%, transparent)"
        textColor="var(--destructive)"
        fillColor="var(--destructive)"
        fillTextColor="var(--background)"
        glow={false}
        waveAmplitude={3}
        doneLabel={<Square className="fill-current" aria-hidden />}
        aria-label="Hold to stop the run"
      >
        <Square className="fill-current" aria-hidden />
      </HoldButton>
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /Hold to remove review/ });
    // A tap does not confirm.
    await userEvent.click(button);
    await expect(args.onHold).not.toHaveBeenCalled();
    // Holding Space past the hold time does.
    button.focus();
    await userEvent.keyboard('[Space>]');
    await waitFor(() => expect(args.onHold).toHaveBeenCalledOnce(), { timeout: 2000 });
    await userEvent.keyboard('[/Space]');
  },
};

export const GlassButton: Story = {
  render: () => (
    <div className="flex h-48 items-center justify-center rounded-xl bg-black">
      <SpecularButton size="sm" radius={10} tintOpacity={0.08} blur={6} proximity={200}>
        Add project
      </SpecularButton>
    </div>
  ),
};
