import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
import { ChatComposer } from '@/components/chat-composer';
import { ChatComposerDemo } from '@/components/chat-composer-demo';

const meta = {
  title: 'Factory/Chat Composer',
  component: ChatComposer,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Original implementation based on the public Chat Composer preview and documentation. Built with shadcn, Tailwind, Motion, and Base UI menus. Integration callbacks own sending, files, approval, app authentication, and speech-to-text; the component opens no microphone or network connection. Enter sends, Shift+Enter inserts a newline, and composition events do not submit. Approval mode is a preference; the caller enforces permissions.',
      },
    },
  },
  args: {
    models: [
      { id: 'auto', name: 'Auto' },
      { id: 'claude', name: 'Claude' },
      { id: 'chatgpt', name: 'ChatGPT' },
    ],
    onSend: fn(),
    onValueChange: fn(),
    onApprovalModeChange: fn(),
    onAttach: fn(),
    onRemoveAttachment: fn(),
    onModelChange: fn(),
    onFolderChange: fn(),
    onAppsChange: fn(),
    folders: ['factory-elections', 'design-notes'],
    apps: [
      { id: 'github', name: 'GitHub' },
      { id: 'slack', name: 'Slack' },
    ],
  },
} satisfies Meta<typeof ChatComposer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const MenuToggling: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const document = canvasElement.ownerDocument;
    const page = within(document.body);
    const controls = [
      ['Request approval', 'How should actions be approved?'],
      ['Model: Auto', 'Choose a model'],
      ['Work in a folder', 'Work in a folder'],
      ['Connect apps, 0 selected', 'Apps'],
    ];
    for (let pass = 0; pass < 3; pass += 1) {
      for (const [triggerName, menuName] of controls) {
        const trigger = canvas.getByRole('button', { name: triggerName });
        await userEvent.click(trigger);
        const menu = await page.findByRole('menu', { name: menuName });
        // Check the first painted frames, including the ordinary-motion entrance.
        // Text and rows should retain their size instead of snapping between scales.
        for (let frame = 0; frame < 2; frame += 1) {
          const style = document.defaultView!.getComputedStyle(menu);
          await expect(style.scale).toBe('none');
          await expect(style.transform).toBe('none');
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(menu).not.toBeInTheDocument());
        await waitFor(() => expect(trigger).toHaveFocus());
      }
    }
    await expect(page.queryByRole('menu')).not.toBeInTheDocument();
  },
};
export const Ready: Story = {
  args: { defaultValue: 'Review the retry flow and preserve the previous attempt.' },
};
export const Sending: Story = { args: { defaultValue: 'Review the latest changes.', sending: true } };
export const Disabled: Story = { args: { defaultValue: 'This composer is disabled.', disabled: true } };
export const Error: Story = {
  args: {
    defaultValue: 'Keep this draft until the service is available.',
    error: 'The service is unavailable. Your draft is saved.',
  },
};
export const Minimal: Story = {
  args: { models: undefined, folders: [], apps: [], onAttach: undefined },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /^Model:/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /^Connect apps/ })).not.toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Message' }), 'A standalone draft.');
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }));
    await expect(args.onSend).toHaveBeenCalledWith('A standalone draft.', {
      model: null,
      approvalMode: 'request',
      folder: null,
      connectedApps: [],
      attachments: [],
    });
  },
};
export const Narrow: Story = {
  args: {
    defaultValue: 'A long prompt in a narrow component container.',
    folder: 'a-very-long-folder-name/with-a-deeply-nested/project',
    folders: ['a-very-long-folder-name/with-a-deeply-nested/project'],
  },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[320px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const form = within(canvasElement).getByRole('form', { name: 'Chat composer' });
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth + 1);
  },
};
export const Attachments: Story = {
  args: {
    defaultValue: 'Please review these files.',
    attachments: [
      { id: 'brief', name: 'brief.md' },
      { id: 'notes', name: 'a-long-file-name-with-review-notes-and-context.txt' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove attachment brief.md' }));
    await expect(args.onRemoveAttachment).toHaveBeenCalledWith({ id: 'brief', name: 'brief.md' });
  },
};
export const ModelAndContext: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Model: Auto' }));
    await userEvent.click(await page.findByRole('menuitemradio', { name: /^Claude/ }));
    await expect(args.onModelChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Work in a folder' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'factory-elections' }));
    await expect(args.onFolderChange).toHaveBeenCalledWith('factory-elections');
    await userEvent.click(canvas.getByRole('button', { name: /^Connect apps/ }));
    await userEvent.click(await page.findByRole('menuitemcheckbox', { name: 'Slack' }));
    await expect(args.onAppsChange).toHaveBeenCalledWith(['slack']);
    await userEvent.keyboard('{Escape}');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Message' }), 'Review this project.');
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }));
    await expect(args.onSend).toHaveBeenCalledWith('Review this project.', {
      model: 'claude',
      approvalMode: 'request',
      folder: 'factory-elections',
      connectedApps: ['slack'],
      attachments: [],
    });
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  },
};
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Message' });
    await userEvent.type(field, 'First line{Shift>}{Enter}{/Shift}Second line');
    await expect(field).toHaveValue('First line\nSecond line');
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(args.onSend).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSend).toHaveBeenCalledWith(
      'First line\nSecond line',
      expect.objectContaining({ model: 'auto' }),
    );
  },
};
export const FailedSend: Story = {
  args: {
    defaultValue: 'Please keep this draft.',
    onSend: fn(async () => {
      throw new globalThis.Error('Message failed. Your draft is saved.');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Message failed. Your draft is saved.');
    await expect(canvas.getByRole('textbox', { name: 'Message' })).toHaveValue('Please keep this draft.');
    await expect(canvas.getByRole('button', { name: 'Send message' })).toBeEnabled();
  },
};
export const SlowSend: Story = {
  args: {
    defaultValue: 'Send exactly once.',
    onSend: fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100))),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.dblClick(canvas.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};
export const ApprovalModes: Story = {
  args: { defaultValue: 'Review with the selected approval policy.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Request approval' }));
    await expect(await page.findByRole('menuitemradio', { name: /^Request approval/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(page.getByRole('menuitemradio', { name: /^Approve for me/ }));
    await expect(args.onApprovalModeChange).toHaveBeenCalledWith('auto');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Approve for me' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Approve for me' }));
    await userEvent.click(await page.findByRole('menuitemradio', { name: /^Full access/ }));
    await expect(args.onApprovalModeChange).toHaveBeenLastCalledWith('full');
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }));
    await expect(args.onSend).toHaveBeenCalledWith(
      'Review with the selected approval policy.',
      expect.objectContaining({ approvalMode: 'full' }),
    );
  },
};
export const FullAccess: Story = { args: { approvalMode: 'full' } };
export const ApprovalKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'Request approval' });
    trigger.focus();
    await userEvent.keyboard('{ArrowUp}');
    const full = await page.findByRole('menuitemradio', { name: /^Full access/ });
    await waitFor(() =>
      expect(page.getByRole('menu', { name: 'How should actions be approved?' })).toContainElement(
        canvasElement.ownerDocument.activeElement as HTMLElement,
      ),
    );
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(full).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(args.onApprovalModeChange).toHaveBeenCalledWith('full');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Full access' })).toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    await page.findByRole('menu', { name: 'How should actions be approved?' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(page.queryByRole('menu', { name: 'How should actions be approved?' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Full access' })).toHaveFocus());
    await expect(args.onApprovalModeChange).toHaveBeenCalledTimes(1);
  },
};
export const Dictation: Story = {
  args: { defaultValue: 'Review', recording: true, dictation: 'the next task', onStopDictation: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Finish dictation' }));
    await expect(args.onStopDictation).toHaveBeenCalledWith(true);
    // The recording flag belongs to the caller; the committed draft is exposed through this callback.
    await expect(args.onValueChange).toHaveBeenCalledWith('Review the next task');
  },
};
export const Controlled: Story = {
  render: function ControlledComposer(args) {
    const [value, setValue] = useState('A draft managed by the caller.');
    return <ChatComposer {...args} value={value} onValueChange={setValue} />;
  },
};
export const Interactive: Story = {
  render: () => <ChatComposerDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await userEvent.click(canvas.getByRole('button', { name: 'Start dictation' }));
    await waitFor(() => expect(field.value).toContain('Summarize'));
    await userEvent.click(field);
    await userEvent.keyboard('{Escape}');
    await expect(field).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Start dictation' })).toBeEnabled();
    await userEvent.type(field, 'Review the next task.');
    await userEvent.click(canvas.getByRole('button', { name: 'Send message' }));
    await expect(canvas.getByRole('region', { name: 'Sent demo message' })).toHaveTextContent(
      'Review the next task.',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Reset demo' }));
    await expect(canvas.queryByRole('region', { name: 'Sent demo message' })).not.toBeInTheDocument();
  },
};
