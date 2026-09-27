export type EditStatus =
  | "queued"
  | "uploading"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export type ProgressEv = {
  ts: string;
  type: "text" | "tool" | "tool_result" | "done" | "error" | "status";
  text?: string;
  name?: string;
  summary?: string;
};

export type AgentEdit = {
  id: string;
  workflow: string;
  slug: string;
  title: string;
  status: EditStatus;
  notes: string;
  sourceUrl: string;
  clipName: string;
  error: string;
  pid: number | null;
  model: string;
  engine: "" | "claude" | "cursor";
  lastTool: string;
  lastText: string;
  hasFinal: boolean;
  hasBand: boolean;
  hasPoster: boolean;
  hasClip: boolean;
  finalBytes: number;
  finalMtime: number | null;
  source: "job" | "library";
  createdAt: string;
  updatedAt: string;
};

export type DiskStatus = {
  status?: EditStatus | "running" | "done" | "failed" | "cancelled";
  pid?: number;
  claudePid?: number;
  sessionId?: string;
  model?: string;
  engine?: "claude" | "cursor";
  lastTool?: string;
  lastText?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  turns?: number;
  cost?: number;
  resumeCount?: number;
  heartbeatAt?: string;
  resumedAt?: string;
  lastError?: string;
  resumeSessionId?: string;
};
