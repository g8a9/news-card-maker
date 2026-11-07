import { h } from '../../render/h.ts';
import type { DialogContent } from './host.ts';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

export const SHORTCUTS: Array<[string, string]> = [
  [`/  or  ${mod} L`, 'Focus the link field'],
  ['Enter', 'Create the card from the link'],
  [`${mod} V`, 'Paste a link (or an image) when no field is focused'],
  [`${mod} C`, 'Copy the card as an image when no text is selected'],
  [`${mod} S`, 'Download the card'],
  ['?', 'Show this help'],
  ['Esc', 'Close a dialog or menu'],
];

export function helpDialog(): DialogContent {
  return {
    title: 'Keyboard shortcuts',
    body: h(
      'div',
      { class: 'dialog-body' },
      h(
        'dl',
        { class: 'shortcuts' },
        ...SHORTCUTS.flatMap(([keys, what]) => [
          h('dt', null, h('kbd', null, keys)),
          h('dd', null, what),
        ]),
      ),
      h(
        'p',
        { class: 'dialog-note' },
        'Click any text on the card to jump to its field. Drag the picture to move its focus.',
      ),
    ),
  };
}
