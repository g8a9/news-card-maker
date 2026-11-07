// Copy and download (PLAN.md §8). The real implementation arrives with milestone M5.
import type { AppState } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';
import { pushToast } from '../ui/toasts.ts';

export interface ExportActions {
  copy(): Promise<void>;
  download(format?: 'png' | 'jpeg' | 'webp'): Promise<void>;
}

export function createExportActions(store: Store<AppState>): ExportActions {
  const notYet = async () => {
    pushToast(store, 'Export is not available yet', 'info');
  };
  return { copy: notYet, download: notYet };
}
