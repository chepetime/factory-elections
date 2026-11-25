// Resizable panes: their id, default and limits in pixels. Shared by the server and the client.
export type PaneSpec = { id: string; default: number; min: number; max: number };

export const TASK_DETAILS_PANE: PaneSpec = { id: 'task-details', default: 440, min: 300, max: 820 };
export const CHAT_LIST_PANE: PaneSpec = { id: 'chat-list', default: 288, min: 220, max: 480 };

export const paneCookie = (id: string) => `factory.pane.${id}`;
