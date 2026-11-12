const Clipboard = {
  setString: (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  },
};
export default Clipboard;
