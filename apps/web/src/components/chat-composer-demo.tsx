'use client';

import { useEffect, useRef, useState } from 'react';
import { GitBranch, MessageSquare, NotebookPen, RotateCcw } from 'lucide-react';
import { ChatComposer, type ChatAttachment, type ChatMessageDetails } from '@/components/chat-composer';
import { Button } from '@/components/ui/button';

const APPS = [
  { id: 'github', name: 'GitHub', logo: <GitBranch className="text-violet-600 dark:text-violet-400" /> },
  { id: 'slack', name: 'Slack', logo: <MessageSquare className="text-blue-600 dark:text-blue-400" /> },
  { id: 'notes', name: 'Notes', logo: <NotebookPen className="text-amber-700 dark:text-amber-400" /> },
];
const TRANSCRIPT = 'Summarize the latest findings and suggest the next step.';

export function ChatComposerDemo() {
  const [version, setVersion] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [dictation, setDictation] = useState('');
  const [sent, setSent] = useState<{ message: string; details: ChatMessageDetails } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const words = TRANSCRIPT.split(' ');
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setDictation(words.slice(0, count).join(' '));
      if (count >= words.length) window.clearInterval(timer);
    }, 180);
    return () => window.clearInterval(timer);
  }, [recording]);

  return (
    <div className="space-y-5">
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Choose sample attachments"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          setAttachments((previous) => [
            ...previous,
            ...files.map((file, index) => ({
              id: `${file.name}-${file.lastModified}-${previous.length + index}`,
              name: file.name,
            })),
          ]);
          event.target.value = '';
        }}
      />
      <ChatComposer
        key={version}
        folders={['factory-elections', 'design-notes', 'research']}
        apps={APPS}
        attachments={attachments}
        onAttach={() => picker.current?.click()}
        onRemoveAttachment={(attachment) =>
          setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))
        }
        onRequestApproval={() => new Promise<void>((resolve) => window.setTimeout(resolve, 700))}
        recording={recording}
        dictation={dictation}
        onStartDictation={() => {
          setDictation('');
          setRecording(true);
        }}
        onStopDictation={() => {
          setRecording(false);
          setDictation('');
        }}
        onSend={(message, details) => {
          setSent({ message, details });
          setAttachments([]);
        }}
      />
      {sent && (
        <div
          role="region"
          aria-label="Sent demo message"
          className="mx-auto max-w-[680px] space-y-2 rounded-xl border bg-background px-5 py-4"
        >
          <p className="text-xs font-medium text-muted-foreground">Sent in this demo</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{sent.message}</p>
          <p className="text-xs text-muted-foreground">
            Model: {sent.details.model} · Folder: {sent.details.folder ?? 'None'} · Apps:{' '}
            {sent.details.connectedApps.length} · Attachments: {sent.details.attachments.length}
          </p>
        </div>
      )}
      <div className="mx-auto flex max-w-[680px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Local preview. Dictation is simulated; messages, file contents, approval requests, and app
          selections are never sent to a service.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0"
          onClick={() => {
            setVersion((value) => value + 1);
            setAttachments([]);
            setRecording(false);
            setDictation('');
            setSent(null);
          }}
        >
          <RotateCcw />
          Reset demo
        </Button>
      </div>
    </div>
  );
}
