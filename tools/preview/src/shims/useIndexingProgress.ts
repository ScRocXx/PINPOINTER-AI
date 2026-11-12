// The indexing queue for the browser preview: everything ready, nothing running.
export const useIndexingProgress = () => ({
  photos: { done: 3400, total: 3400, running: false, queued: false, quick: false },
  papers: { done: 6, total: null, running: false, queued: false },
});
