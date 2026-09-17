/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SourcesGetFolderHierarchyV1Result {
  sourceId: string;
  nodes: SourceFolderHierarchyNode[];
}
export interface SourceFolderHierarchyNode {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  pathName: string;
  artificialRoot: boolean;
  directLeafChildren: number;
  totalLeafChildren: number;
  directChildNodes: number;
}
