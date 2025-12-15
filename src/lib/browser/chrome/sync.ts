import { NodeData, TreeNode } from '~/lib/sync/tree';

export class ChromeBookmarkNodeData extends NodeData {
	rawData: chrome.bookmarks.BookmarkTreeNode;

	constructor(data: chrome.bookmarks.BookmarkTreeNode) {
		super();
		this.rawData = data;
	}

	getId(): string {
		return this.rawData.id;
	}

	getName(): string {
		return this.rawData.title;
	}

	getParentId(): string | null {
		return this.rawData.parentId || null;
	}
}

/**
 * Creates a tree structure from Chrome bookmarks.
 * @returns Root node of the tree
 */
export async function createTreeFromChromeBookmarks(): Promise<TreeNode<ChromeBookmarkNodeData>> {
	const tree = await chrome.bookmarks.getTree();
	const root = tree[0];

	// Perform BFS to flatten the tree
	const dataList = [];
	const queue = [root];
	while (queue.length > 0) {
		const node = queue.shift()!;
		dataList.push(new ChromeBookmarkNodeData(node));
		if (node.children) {
			for (const child of node.children) {
				queue.push(child);
			}
		}
	}

	const wrappingRoot = TreeNode.createTree(null, dataList);
	const realRoot = wrappingRoot.children[0];
	return realRoot;
}
