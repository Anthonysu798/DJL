export function toggleBrowserPanelWithGuard(input: {
  browserOpen: boolean;
  requestClose: ((onClosed?: () => void) => void) | undefined;
  toggle: () => void;
}): void {
  if (input.browserOpen && input.requestClose) {
    input.requestClose();
    return;
  }
  input.toggle();
}

export function replaceBrowserPanelWithGuard(input: {
  browserOpen: boolean;
  requestClose: ((onClosed?: () => void) => void) | undefined;
  replace: () => void;
}): void {
  if (input.browserOpen && input.requestClose) {
    input.requestClose(input.replace);
    return;
  }
  input.replace();
}
