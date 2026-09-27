/** Wire format written by scripts/system-graph-export.mjs. */

export type SystemNode = {
  id: string; // "<type>:<key>"
  t: number; // index into SystemGraph.types
  label: string;
  description?: string;
  files?: string[];
  envs?: string[];
  /** automations: default ET hours */
  hours?: string[];
  envPrefix?: string;
  args?: string[];
  /** routes: exported HTTP methods */
  methods?: string[];
  /** pages: dashboard route */
  route?: string;
  /** skills/scripts: wired to a scheduled automation */
  live?: boolean;
};

/** [source, target, edgeType, weight] */
export type SystemEdge = [number, number, number, number];

export type SystemGraph = {
  version: 1;
  generatedAt: string;
  commit: string;
  types: string[];
  edgeTypes: string[];
  nodes: SystemNode[];
  edges: SystemEdge[];
};

export type SystemGraphMeta = {
  generatedAt: string;
  commit: string;
  nodes: number;
  edges: number;
  byType: Record<string, number>;
};
