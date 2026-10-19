// Keep the installed app at its intended scale without preventing one-finger scrolling.
export function lockViewportZoom(target = document) {
  const prevent = event => event.preventDefault();
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(name, prevent, { passive: false });
  }
  for (const name of ['touchstart', 'touchmove']) {
    target.addEventListener(name, event => {
      if (event.touches?.length > 1) event.preventDefault();
    }, { passive: false });
  }
  target.addEventListener('wheel', event => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });
}
