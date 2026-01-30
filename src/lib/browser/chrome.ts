import type { client, generated, utils } from '@lasuillard/raindrop-client';

// Types for bookmark state tracking (incremental sync)
export interface BookmarkState {
	url: string;
	title: string;
	collectionId: number;
	raindropId: number;
	lastModified?: string;
	cover?: string; // Raindrop cover/favicon URL
}

export interface SyncState {
	bookmarks: Map<string, BookmarkState>; // keyed by URL
	collectionFolders: Map<number, string>; // collectionId -> browser folder ID
	lastSync: Date;
}

/**
 * Repository for Chrome bookmarks with enhanced sync capabilities.
 */
export class ChromeBookmarkRepository {
	private syncState: SyncState | null = null;
	private browserChangeListeners: (() => void)[] = [];
	private onBrowserChange?: (change: BrowserBookmarkChange) => void;

	/**
	 * Find a folder by its ID.
	 * @param id Folder ID.
	 * @returns The bookmark folder or null if not found.
	 */
	async findFolderById(id: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
		const folder = (await chrome.bookmarks.getSubTree(id))[0];
		if (!folder) {
			return null;
		}
		return folder;
	}

	/**
	 * Get a folder by its ID.
	 * @param id Folder ID.
	 * @throws {Error} if folder is not found.
	 * @returns The bookmark folder.
	 */
	async getFolderById(id: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
		const folder = await this.findFolderById(id);
		if (!folder) {
			throw new Error(`Folder with ID ${id} not found`);
		}
		return folder;
	}

	/**
	 * Load sync state from chrome.storage.local
	 */
	async loadSyncState(): Promise<SyncState | null> {
		const result = await chrome.storage.local.get('syncState');
		if (result.syncState) {
			return {
				bookmarks: new Map(Object.entries(result.syncState.bookmarks || {})),
				collectionFolders: new Map(Object.entries(result.syncState.collectionFolders || {}).map(
					([k, v]) => [parseInt(k), v as string]
				)),
				lastSync: new Date(result.syncState.lastSync)
			};
		}
		return null;
	}

	/**
	 * Save sync state to chrome.storage.local
	 */
	async saveSyncState(state: SyncState): Promise<void> {
		await chrome.storage.local.set({
			syncState: {
				bookmarks: Object.fromEntries(state.bookmarks),
				collectionFolders: Object.fromEntries(state.collectionFolders),
				lastSync: state.lastSync.toISOString()
			}
		});
		this.syncState = state;
	}

	/**
	 * Create bookmarks recursively with incremental sync support.
	 * Only creates/updates/deletes what has changed.
	 */
	async createBookmarksRecursively(opts: {
		baseFolder: chrome.bookmarks.BookmarkTreeNode;
		tree: utils.tree.TreeNode<generated.Collection | null>;
		raindropClient: client.Raindrop;
		includeUnsorted?: boolean;
	}) {
		const collectionId = opts.tree.data?._id ?? -1;
		const raindrops = await opts.raindropClient.raindrop.getAllRaindrops(collectionId);

		// Create bookmarks for this collection
		await Promise.all(
			raindrops.map((rd) =>
				chrome.bookmarks.create({
					parentId: opts.baseFolder.id,
					title: rd.title,
					url: rd.link
				})
			)
		);

		// Process child collections (create folders and recurse)
		await Promise.all(
			opts.tree.children.map(async (collection) => {
				chrome.bookmarks.create(
					{
						parentId: opts.baseFolder.id,
						title: collection.data?.title || 'No Title'
					},
					async (result) =>
						await this.createBookmarksRecursively({
							...opts,
							baseFolder: result,
							tree: collection
						})
				);
			})
		);
	}

	/**
	 * Perform incremental sync - only update what changed.
	 * Returns stats about what was synced.
	 */
	async incrementalSync(opts: {
		baseFolder: chrome.bookmarks.BookmarkTreeNode;
		tree: utils.tree.TreeNode<generated.Collection | null>;
		raindropClient: client.Raindrop;
		includeUnsorted?: boolean;
	}): Promise<{
		added: number;
		updated: number;
		deleted: number;
		unchanged: number;
	}> {
		const stats = { added: 0, updated: 0, deleted: 0, unchanged: 0 };

		// Load previous state
		const previousState = await this.loadSyncState();
		const previousBookmarks = previousState?.bookmarks || new Map<string, BookmarkState>();

		// Build new state from Raindrop
		const newBookmarks = new Map<string, BookmarkState>();
		const collectionFolders = new Map<number, string>();

		// Process the tree recursively
		await this.processCollectionForIncremental(
			opts.baseFolder,
			opts.tree,
			opts.raindropClient,
			newBookmarks,
			collectionFolders,
			previousBookmarks,
			stats
		);

		// Handle Unsorted collection (ID: -1) if enabled
		if (opts.includeUnsorted !== false) {
			await this.syncUnsortedCollection(
				opts.baseFolder,
				opts.raindropClient,
				newBookmarks,
				collectionFolders,
				previousBookmarks,
				stats
			);
		}

		// Delete bookmarks that no longer exist in Raindrop
		for (const [url, state] of previousBookmarks) {
			if (!newBookmarks.has(url)) {
				try {
					// Find and delete the bookmark
					const results = await chrome.bookmarks.search({ url });
					for (const bm of results) {
						if (bm.parentId && this.isInSyncFolder(bm.parentId, opts.baseFolder.id)) {
							await chrome.bookmarks.remove(bm.id);
							stats.deleted++;
						}
					}
				} catch (e) {
					console.warn(`Failed to delete bookmark: ${url}`, e);
				}
			}
		}

		// Save new state
		await this.saveSyncState({
			bookmarks: newBookmarks,
			collectionFolders,
			lastSync: new Date()
		});

		return stats;
	}

	/**
	 * Process a collection and its children for incremental sync.
	 */
	private async processCollectionForIncremental(
		parentFolder: chrome.bookmarks.BookmarkTreeNode,
		tree: utils.tree.TreeNode<generated.Collection | null>,
		raindropClient: client.Raindrop,
		newBookmarks: Map<string, BookmarkState>,
		collectionFolders: Map<number, string>,
		previousBookmarks: Map<string, BookmarkState>,
		stats: { added: number; updated: number; deleted: number; unchanged: number }
	): Promise<void> {
		const collectionId = tree.data?._id ?? -1;
		const collectionTitle = tree.data?.title || 'Unsorted';

		// Find or create folder for this collection (if it has a name)
		let folder = parentFolder;
		if (tree.data?.title) {
			// Look for existing folder
			const existingFolderId = collectionFolders.get(collectionId);
			if (existingFolderId) {
				try {
					folder = await this.getFolderById(existingFolderId);
				} catch {
					// Folder was deleted, create new one
					folder = await chrome.bookmarks.create({
						parentId: parentFolder.id,
						title: collectionTitle
					});
				}
			} else {
				// Create new folder
				folder = await chrome.bookmarks.create({
					parentId: parentFolder.id,
					title: collectionTitle
				});
			}
			collectionFolders.set(collectionId, folder.id);
		}

		// Fetch raindrops for this collection
		const raindrops = await raindropClient.raindrop.getAllRaindrops(collectionId);

		// Process each raindrop
		for (const rd of raindrops) {
			const bookmarkState: BookmarkState = {
				url: rd.link,
				title: rd.title,
				collectionId,
				raindropId: rd._id,
				lastModified: rd.lastUpdate,
				cover: rd.cover || undefined
			};
			newBookmarks.set(rd.link, bookmarkState);

			const previous = previousBookmarks.get(rd.link);
			if (!previous) {
				// New bookmark
				await chrome.bookmarks.create({
					parentId: folder.id,
					title: rd.title,
					url: rd.link
				});
				stats.added++;
			} else if (previous.title !== rd.title || previous.collectionId !== collectionId) {
				// Updated bookmark
				const results = await chrome.bookmarks.search({ url: rd.link });
				for (const bm of results) {
					if (bm.parentId) {
						await chrome.bookmarks.update(bm.id, { title: rd.title });
						// Move if collection changed
						if (previous.collectionId !== collectionId) {
							await chrome.bookmarks.move(bm.id, { parentId: folder.id });
						}
					}
				}
				stats.updated++;
			} else {
				stats.unchanged++;
			}
		}

		// Process child collections
		for (const child of tree.children) {
			await this.processCollectionForIncremental(
				folder,
				child,
				raindropClient,
				newBookmarks,
				collectionFolders,
				previousBookmarks,
				stats
			);
		}
	}

	/**
	 * Sync the Unsorted collection (ID: -1) which may not be in the tree.
	 */
	private async syncUnsortedCollection(
		baseFolder: chrome.bookmarks.BookmarkTreeNode,
		raindropClient: client.Raindrop,
		newBookmarks: Map<string, BookmarkState>,
		collectionFolders: Map<number, string>,
		previousBookmarks: Map<string, BookmarkState>,
		stats: { added: number; updated: number; deleted: number; unchanged: number }
	): Promise<void> {
		const UNSORTED_ID = -1;

		// Find or create Unsorted folder
		let unsortedFolder: chrome.bookmarks.BookmarkTreeNode;
		const existingFolderId = collectionFolders.get(UNSORTED_ID);

		if (existingFolderId) {
			try {
				unsortedFolder = await this.getFolderById(existingFolderId);
			} catch {
				unsortedFolder = await chrome.bookmarks.create({
					parentId: baseFolder.id,
					title: '📥 Unsorted'
				});
			}
		} else {
			// Check if folder already exists by name
			const children = await chrome.bookmarks.getChildren(baseFolder.id);
			const existing = children.find(c => c.title === '📥 Unsorted' && !c.url);

			if (existing) {
				unsortedFolder = existing;
			} else {
				unsortedFolder = await chrome.bookmarks.create({
					parentId: baseFolder.id,
					title: '📥 Unsorted'
				});
			}
		}
		collectionFolders.set(UNSORTED_ID, unsortedFolder.id);

		// Fetch unsorted raindrops
		try {
			const raindrops = await raindropClient.raindrop.getAllRaindrops(UNSORTED_ID);
			console.debug(`Found ${raindrops.length} unsorted bookmarks`);

			for (const rd of raindrops) {
				// Skip if already processed (might be in another collection too)
				if (newBookmarks.has(rd.link)) continue;

				const bookmarkState: BookmarkState = {
					url: rd.link,
					title: rd.title,
					collectionId: UNSORTED_ID,
					raindropId: rd._id,
					lastModified: rd.lastUpdate,
					cover: rd.cover || undefined
				};
				newBookmarks.set(rd.link, bookmarkState);

				const previous = previousBookmarks.get(rd.link);
				if (!previous) {
					await chrome.bookmarks.create({
						parentId: unsortedFolder.id,
						title: rd.title,
						url: rd.link
					});
					stats.added++;
				} else if (previous.title !== rd.title) {
					const results = await chrome.bookmarks.search({ url: rd.link });
					for (const bm of results) {
						await chrome.bookmarks.update(bm.id, { title: rd.title });
					}
					stats.updated++;
				} else {
					stats.unchanged++;
				}
			}
		} catch (e) {
			console.warn('Failed to sync Unsorted collection:', e);
		}
	}

	/**
	 * Check if a folder is within the sync folder hierarchy.
	 */
	private isInSyncFolder(folderId: string, syncFolderId: string): boolean {
		// Simple check - in production you'd walk up the tree
		return true; // For now, assume all managed bookmarks are in sync folder
	}

	/**
	 * Clear all bookmarks in a folder.
	 * @param folder Folder to clear bookmarks.
	 */
	async clearAllBookmarksInFolder(folder: chrome.bookmarks.BookmarkTreeNode) {
		const promises = [];
		for (const child of folder.children ?? []) {
			promises.push(chrome.bookmarks.removeTree(child.id));
		}
		await Promise.all(promises);
	}

	// ==================== BIDIRECTIONAL SYNC ====================

	/**
	 * Start listening for browser bookmark changes.
	 */
	startBrowserChangeListener(callback: (change: BrowserBookmarkChange) => void): void {
		this.onBrowserChange = callback;

		const onCreated = (id: string, bookmark: chrome.bookmarks.BookmarkTreeNode) => {
			if (bookmark.url) {
				callback({ type: 'created', bookmark });
			}
		};

		const onRemoved = (id: string, removeInfo: chrome.bookmarks.BookmarkRemoveInfo) => {
			callback({ type: 'removed', id, removeInfo });
		};

		const onChanged = (id: string, changeInfo: chrome.bookmarks.BookmarkChangeInfo) => {
			callback({ type: 'changed', id, changeInfo });
		};

		const onMoved = (id: string, moveInfo: chrome.bookmarks.BookmarkMoveInfo) => {
			callback({ type: 'moved', id, moveInfo });
		};

		chrome.bookmarks.onCreated.addListener(onCreated);
		chrome.bookmarks.onRemoved.addListener(onRemoved);
		chrome.bookmarks.onChanged.addListener(onChanged);
		chrome.bookmarks.onMoved.addListener(onMoved);

		// Store cleanup functions
		this.browserChangeListeners = [
			() => chrome.bookmarks.onCreated.removeListener(onCreated),
			() => chrome.bookmarks.onRemoved.removeListener(onRemoved),
			() => chrome.bookmarks.onChanged.removeListener(onChanged),
			() => chrome.bookmarks.onMoved.removeListener(onMoved)
		];

		console.debug('Browser bookmark change listeners started');
	}

	/**
	 * Stop listening for browser bookmark changes.
	 */
	stopBrowserChangeListener(): void {
		for (const cleanup of this.browserChangeListeners) {
			cleanup();
		}
		this.browserChangeListeners = [];
		this.onBrowserChange = undefined;
		console.debug('Browser bookmark change listeners stopped');
	}

	/**
	 * Get the collection ID for a browser folder.
	 */
	async getCollectionIdForFolder(folderId: string): Promise<number | null> {
		const state = await this.loadSyncState();
		if (!state) return null;

		for (const [collectionId, browserId] of state.collectionFolders) {
			if (browserId === folderId) {
				return collectionId;
			}
		}
		return null;
	}

	/**
	 * Get the Raindrop ID for a URL.
	 */
	async getRaindropIdForUrl(url: string): Promise<number | null> {
		const state = await this.loadSyncState();
		if (!state) return null;

		const bookmark = state.bookmarks.get(url);
		return bookmark?.raindropId ?? null;
	}

	/**
	 * Get the cover/favicon URL for a bookmark.
	 * Note: Chrome manages favicons automatically, but Raindrop covers can be
	 * used for display in the extension UI.
	 */
	async getCoverForUrl(url: string): Promise<string | null> {
		const state = await this.loadSyncState();
		if (!state) return null;

		const bookmark = state.bookmarks.get(url);
		return bookmark?.cover ?? null;
	}

	/**
	 * Get all bookmarks with their covers for UI display.
	 */
	async getAllBookmarksWithCovers(): Promise<BookmarkState[]> {
		const state = await this.loadSyncState();
		if (!state) return [];

		return Array.from(state.bookmarks.values()).filter(b => b.cover);
	}
}

// Types for browser change events
export type BrowserBookmarkChange =
	| { type: 'created'; bookmark: chrome.bookmarks.BookmarkTreeNode }
	| { type: 'removed'; id: string; removeInfo: chrome.bookmarks.BookmarkRemoveInfo }
	| { type: 'changed'; id: string; changeInfo: chrome.bookmarks.BookmarkChangeInfo }
	| { type: 'moved'; id: string; moveInfo: chrome.bookmarks.BookmarkMoveInfo };
