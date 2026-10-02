/** The slice of Bootstrap's bundle (loaded globally by index.html) that the client uses. */
interface BootstrapPopover {
  setContent(content: Record<string, string>): void;
  hide(): void;
  dispose(): void;
}

interface BootstrapPopoverOptions {
  trigger?: string;
  placement?: string;
  title?: string;
  content?: string;
  html?: boolean;
  customClass?: string;
}

interface Window {
  bootstrap?: {
    Popover: {
      getInstance(element: Element): BootstrapPopover | null;
      getOrCreateInstance(element: Element, options?: BootstrapPopoverOptions): BootstrapPopover;
    };
  };
}
