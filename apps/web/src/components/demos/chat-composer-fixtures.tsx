import { Aperture, Sparkles } from 'lucide-react';
import { GmailMark, SlackMark, ClickUpMark, ClaudeMark } from './chat-composer-marks';

export const CHAT_DEMO_APPS = [
  { id: 'gmail', name: 'Gmail', logo: <GmailMark /> },
  { id: 'slack', name: 'Slack', logo: <SlackMark /> },
  { id: 'clickup', name: 'ClickUp', logo: <ClickUpMark /> },
];
// Display fixtures from the supplied reference; integrations choose their own actual model IDs.
export const CHAT_DEMO_MODELS = [
  { id: 'auto', name: 'Auto', icon: <Sparkles /> },
  { id: 'claude-fable', name: 'Claude Fable 5.1', icon: <ClaudeMark /> },
  { id: 'claude-opus', name: 'Claude Opus 5.5', icon: <ClaudeMark /> },
  { id: 'claude-sonnet', name: 'Claude Sonnet 5.5', icon: <ClaudeMark /> },
  { id: 'claude-haiku', name: 'Claude Haiku 5.5', icon: <ClaudeMark /> },
  { id: 'gpt', name: 'GPT-5', icon: <Aperture /> },
];
export const CHAT_DEMO_FOLDERS = ['Q3 Campaign', 'Brand assets', 'Hiring', 'Research'];

export const CHAT_DEMO_ADD_ACTIONS = [{ id: 'claude-context', label: 'Attach Claude', icon: <ClaudeMark /> }];
