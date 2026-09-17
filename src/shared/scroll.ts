export function resetScrollPosition(): void {
  const scrollTarget = globalThis as typeof globalThis & {
    scrollTo?: (options: { top: number; left: number; behavior?: 'auto' | 'instant' | 'smooth' | string }) => void;
  };

  if (typeof scrollTarget.scrollTo !== 'function') return;

  scrollTarget.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto',
  });
}
