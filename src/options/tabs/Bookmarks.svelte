<script lang="ts">
	import { Button, P, Spinner } from 'flowbite-svelte';
	import { onMount } from 'svelte';
	import Tree from '~/components/Tree.svelte';
	import type { ChromeBookmarkNodeData } from '~/lib/browser/chrome';
	import { createTreeFromChromeBookmarks } from '~/lib/browser/chrome';
	import rd, { createTreeFromRaindrops, RaindropNodeData } from '~/lib/raindrop';
	import type { TreeNode } from '~/lib/sync/tree';

	let raindropTree: TreeNode<RaindropNodeData>;
	let isFetchingRaindrops = false;
	let chromeBookmarkTree: TreeNode<ChromeBookmarkNodeData>;
	let isFetchingChrome = false;

	const makeRaindropBookmarkTree = async () => {
		isFetchingRaindrops = true;
		try {
			raindropTree = await createTreeFromRaindrops(rd);
		} finally {
			isFetchingRaindrops = false;
		}
	};

	const makeChromeBookmarkTree = async () => {
		isFetchingChrome = true;
		try {
			chromeBookmarkTree = await createTreeFromChromeBookmarks();
		} finally {
			isFetchingChrome = false;
		}
	};

	onMount(async () => {
		await makeChromeBookmarkTree();
	});
</script>

<div>
	<P class="text-gray-700">Configure and preview your synchronization settings.</P>
	<div class="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="mb-4 flex items-center justify-between">
				<P class="font-semibold text-gray-800">Raindrop.io Bookmarks</P>
				<Button size="xs" outline onclick={makeRaindropBookmarkTree} disabled={isFetchingRaindrops}>
					{#if isFetchingRaindrops}
						<Spinner size="4" class="mr-1" />
					{/if}
					Fetch
				</Button>
			</div>
			{#if raindropTree}
				<div class="max-h-[600px] overflow-y-auto">
					<Tree treeNode={raindropTree} collapsed={false}></Tree>
				</div>
			{:else}
				<div class="flex h-[300px] items-center justify-center">
					<P class="text-gray-500 italic">Waiting for data...</P>
				</div>
			{/if}
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="mb-4 flex items-center justify-between">
				<P class="font-semibold text-gray-800">Chrome Bookmarks</P>
				<Button size="xs" outline onclick={makeChromeBookmarkTree} disabled={isFetchingChrome}>
					{#if isFetchingChrome}
						<Spinner size="4" class="mr-1" />
					{/if}
					Reload
				</Button>
			</div>
			{#if chromeBookmarkTree}
				<div class="max-h-[600px] overflow-y-auto">
					<Tree treeNode={chromeBookmarkTree} collapsed={false}></Tree>
				</div>
			{:else}
				<div class="flex h-[300px] items-center justify-center">
					<P class="text-gray-500 italic">Waiting for data...</P>
				</div>
			{/if}
		</div>
	</div>
</div>
