// AsyncStorage for the browser preview: an in-memory map.
const store = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: async (k: string) => {
    store.delete(k);
  },
  clear: async () => store.clear(),
};
export default AsyncStorage;
