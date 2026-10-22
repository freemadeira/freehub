/** What has focus now, to give it back to later: nothing when it's just the page. */
export function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null;
}

/**
 * Where focus goes once a dialog opened without a button of its own closes:
 * back to what had it, if it's still there, else nowhere, rather than to
 * whatever last opened a popup.
 */
export function returnFocus(opener: HTMLElement | null) {
  return () => (opener?.isConnected ? opener : false);
}
