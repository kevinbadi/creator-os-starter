export type ClonePersonaId = "megan" | "danny" | "kevin";
export type CloneFormat = "shortform" | "longform";

export type CloneStatus =
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

export type AgentClone = {
  id: string;
  persona: ClonePersonaId;
  format: CloneFormat;
  slug: string;
  title: string;
  status: CloneStatus;
  notes: string;
  sourceUrl: string;
  clipName: string;
  error: string;
  pid: number | null;
  model: string;
  lastTool: string;
  lastText: string;
  hasFinal: boolean;
  hasPreview: boolean;
  hasPoster: boolean;
  hasClip: boolean;
  finalBytes: number;
  finalMtime: number | null;
  source: "job" | "library";
  createdAt: string;
  updatedAt: string;
};

export type DiskStatus = {
  status?: CloneStatus | "running" | "done" | "failed" | "cancelled";
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
};
