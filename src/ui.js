import { h } from 'preact';
import htm from 'htm';
export const html = htm.bind(h);

const P = {
  check: 'M5 12.5l4.2 4.2L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 8v5M12 16.5v.5',
  info: 'M12 11v5M12 7.5v.5',
  dot: '',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  play: 'M8 5v14l11-7z',
  inbox: 'M4 13l2.5-7h11L20 13M4 13v5a1 1 0 001 1h14a1 1 0 001-1v-5M4 13h4.5l1 2h5l1-2H20',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
};
export const Icon = ({ n, s = 16, w = 2, cls = '' }) => html`<svg class=${'ic ' + cls} width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n]} /></svg>`;

export const STATUS = {
  approved: { label: 'Approved for payment', cls: 'ok' },
  needs_approval: { label: 'Needs approval', cls: 'warn' },
  vendor_hold: { label: 'On hold — vendor query', cls: 'hold' },
  rejected: { label: 'Rejected', cls: 'bad' },
  new: { label: 'Not processed', cls: '' },
  running: { label: 'Running', cls: 'run' },
  error: { label: 'Error', cls: 'bad' },
};
export const Pill = ({ status, label }) => {
  const s = STATUS[status] || { label: status, cls: '' };
  return html`<span class=${'pill ' + s.cls}><i></i>${label || s.label}</span>`;
};

// Level marker for an individual check line.
export const LevelIcon = ({ level }) => {
  const m = { pass: ['check', 'ok'], info: ['info', 'muted'], warn: ['alert', 'warn'], block: ['x', 'bad'] }[level] || ['info', 'muted'];
  return html`<span class=${'lvl ' + m[1]}><${Icon} n=${m[0]} s=${12} w=${2.6} /></span>`;
};

export const StageGlyph = ({ state }) => {
  if (state === 'running') return html`<span class="sg run"><span class="spin"></span></span>`;
  const m = { pass: ['check', 'ok'], warn: ['alert', 'warn'], fail: ['x', 'bad'], skip: ['arrow', 'muted'] }[state];
  if (!m) return html`<span class="sg idle"></span>`;
  return html`<span class=${'sg ' + m[1]}><${Icon} n=${m[0]} s=${13} w=${2.8} /></span>`;
};

export const Empty = ({ icon = 'inbox', title, children }) => html`
  <div class="empty"><div class="empty-ic"><${Icon} n=${icon} s=${22} /></div><h3>${title}</h3><div class="muted">${children}</div></div>`;

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 2600);
}
