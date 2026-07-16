export type DimNode = {
  id: string;
  key: string;
  displayName: string;
  dimensionTypeId: string;
  parentId: string | null;
  path: string;
  costCenterCode?: string | null;
  ownerEmail?: string | null;
};

export type TreeNode = DimNode & { children: TreeNode[]; depth: number };

/** Build forest of roots for nodes of one dimension type (or mixed if same path space). */
export function buildTree(nodes: DimNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    byId.set(n.id, { ...n, children: [], depth: 0 });
  }
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent =
      n.parentId && byId.has(n.parentId) ? byId.get(n.parentId)! : null;
    if (parent) {
      parent.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const assignDepth = (node: TreeNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const c of node.children) assignDepth(c, depth + 1);
  };
  roots.sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const r of roots) assignDepth(r, 0);
  return roots;
}

/** Flatten tree in preorder for indented lists. */
export function flattenTree(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export function slugKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function childPath(parentPath: string | null, key: string): string {
  if (!parentPath || parentPath === "/") return `/${key}`;
  return `${parentPath.replace(/\/$/, "")}/${key}`;
}
