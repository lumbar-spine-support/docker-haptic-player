import { qs } from '../../utils/html';
import { storedSetting } from '../../utils/storedSetting';

/** A settings checkbox persisted in localStorage; `apply` runs for the initial value and every change. */
export function bindToggle(selector: string, storageKey: string, fallback: boolean, apply: (enabled: boolean) => void): void {
  const toggle = qs<HTMLInputElement>(selector);
  const setting = storedSetting(storageKey, fallback);
  const enabled = setting.get();
  apply(enabled);
  if (!toggle) return;
  toggle.checked = enabled;
  toggle.addEventListener('change', () => {
    setting.set(toggle.checked);
    apply(toggle.checked);
  });
}
