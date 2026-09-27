/** Wire format written by scripts/gitnexus-export.mjs (indices everywhere). */

export type RepoGraphRepo = {
  name: string;
  path: string;
  branch: string;
  commit: string;
  indexedAt: string;
  stats: {
    files: number;
    nodes: number;
    edges: number;
    communities: number;
    processes: number;
    embeddings: number;
  };
};

export type RepoGraphCluster = {
  label: string;
  symbols: number;
  cohesion: number;
  communities: number;
};

/** [kind, name, filePath, cluster (-1 = none), startLine, endLine] */
export type RepoGraphNode = [number, string, string, number, number, number];

/** [source, target, edgeType, confidence] */
export type RepoGraphEdge = [number, number, number, number];

export type RepoGraphFlow = {
  label: string;
  type: string;
  entry: number;
  steps: number[];
};

export type RepoGraph = {
  version: 1;
  repo: RepoGraphRepo;
  kinds: string[];
  edgeTypes: string[];
  clusters: RepoGraphCluster[];
  nodes: RepoGraphNode[];
  edges: RepoGraphEdge[];
  flows: RepoGraphFlow[];
};

export type RepoGraphMeta = {
  repo: RepoGraphRepo;
  clusters: number;
  nodes: number;
  edges: number;
  flows: number;
};
