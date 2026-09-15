/* ---------------------------------------------------------------------------
   render.js — the pieces of interface that three different pages need:
   the question itself, the confidence picker, sounds and toasts.
--------------------------------------------------------------------------- */

import { TIERS, preview } from './scoring.js';

export const LETTERS = 'ABCDEFGHIJ';

export const el = (tag, props = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- the answer widget ------------------------------------------ */

/**
 * Builds the controls a student uses to answer, and reports changes.
 *
 * @param {object} q        public question (never contains the answer)
 * @param {object} opts     { value, onChange, disabled, key, result }
 *                          `key` and `result` are supplied only after reveal,
 *                          to paint the right and wrong choices.
 * @returns {HTMLElement}
 */
export function answerWidget(q, opts = {}) {
  const { onChange = () => {}, disabled = false, key = null } = opts;
  let value = opts.value ?? defaultValue(q);
  const emit = () => onChange(value);

  const wrap = el('div', { class: 'answer-widget' });

  let rows = [];

  const choiceList = (labels, multi) => {
    rows = [];
    labels.forEach((label, i) => {
      const chosen = multi ? (value || []).includes(i) : value === i || String(value) === String(i);
      const cls = ['opt'];
      if (chosen) cls.push('chosen');
      if (key) {
        const rightHere = multi
          ? (key.answer || []).includes(i)
          : (q.type === 'true_false' ? key.answer === (i === 0 ? 'true' : 'false') : key.answer === i);
        if (rightHere) cls.push('right');
        else if (chosen) cls.push('wrongpick');
      }
      const row = el('label', { class: cls.join(' '), 'aria-disabled': disabled ? 'true' : null }, [
        el('input', {
          type: multi ? 'checkbox' : 'radio',
          name: `q-${q.id}`,
          checked: chosen,
          disabled,
          onchange: (e) => {
            if (multi) {
              const set = new Set(value || []);
              e.target.checked ? set.add(i) : set.delete(i);
              value = [...set].sort((a, b) => a - b);
            } else {
              value = q.type === 'true_false' ? (i === 0 ? 'true' : 'false') : i;
            }
            repaint();
            emit();
          }
        }),
        el('span', { class: 'key', text: LETTERS[i] }),
        el('span', { class: 'grow', text: label })
      ]);
      rows.push(row);
      wrap.appendChild(row);
    });
  };

  /** Only the selected state changes on a tap, so nothing is torn down. */
  function repaint() {
    const multi = q.type === 'mcq_multi';
    rows.forEach((row, i) => {
      const chosen = multi
        ? (value || []).includes(i)
        : (q.type === 'true_false' ? value === (i === 0 ? 'true' : 'false') : value === i);
      row.classList.toggle('chosen', chosen);
    });
  }

  function build() {
    wrap.textContent = '';
    switch (q.type) {
      case 'true_false':
        choiceList(['True', 'False'], false);
        break;
      case 'mcq_single':
        choiceList(q.options || [], false);
        break;
      case 'mcq_multi':
        wrap.appendChild(el('p', { class: 'tiny muted', text: 'Tick every answer that applies.' }));
        choiceList(q.options || [], true);
        break;

      case 'matching': {
        const grid = el('div', { class: 'match-grid' });
        (q.left || []).forEach((l, i) => {
          const sel = el('select', {
            disabled,
            onchange: (e) => { value = [...(value || [])]; value[i] = Number(e.target.value); emit(); }
          }, [
            el('option', { value: '-1', text: 'Choose…' }),
            ...(q.right || []).map((r, j) =>
              el('option', { value: j, text: r, selected: (value || [])[i] === j }))
          ]);
          const row = el('div', { class: 'match-row' }, [el('span', { class: 'lhs', text: l }), sel]);
          if (key) {
            const ok = Number((value || [])[i]) === Number(key.answer[i]);
            row.style.borderColor = ok ? 'var(--jade)' : 'var(--rose)';
            row.appendChild(el('span', {
              class: 'tiny muted',
              text: ok ? '' : `correct: ${(q.right || [])[key.answer[i]]}`
            }));
          }
          grid.appendChild(row);
        });
        wrap.appendChild(grid);
        break;
      }

      case 'ordering': {
        wrap.appendChild(el('p', { class: 'tiny muted', text: 'Move items until the order is right.' }));
        const order = value && value.length ? value : (q.items || []).map((_, i) => i);
        value = order;
        const list = el('ol', { class: 'order-list' });
        order.forEach((itemIdx, pos) => {
          const li = el('li', {}, [
            el('span', { class: 'rank', text: String(pos + 1) }),
            el('span', { class: 'grow', text: (q.items || [])[itemIdx] }),
            disabled ? null : el('span', { class: 'mover' }, [
              el('button', { type: 'button', title: 'Move up', disabled: pos === 0, onclick: () => swap(pos, pos - 1), text: '↑' }),
              el('button', { type: 'button', title: 'Move down', disabled: pos === order.length - 1, onclick: () => swap(pos, pos + 1), text: '↓' })
            ])
          ]);
          if (key) {
            const ok = Number(key.answer[pos]) === Number(itemIdx);
            li.style.borderColor = ok ? 'var(--jade)' : 'var(--rose)';
          }
          list.appendChild(li);
        });
        wrap.appendChild(list);
        break;
      }

      case 'short_answer': {
        wrap.appendChild(el('input', {
          type: 'text',
          value: value || '',
          disabled,
          placeholder: 'Type your answer',
          oninput: (e) => { value = e.target.value; emit(); }
        }));
        if (key) {
          wrap.appendChild(el('p', { class: 'tiny muted', text: `Accepted: ${(key.answer || []).join(' / ')}` }));
        }
        break;
      }
    }
  }

  function swap(a, b) {
    const next = [...value];
    [next[a], next[b]] = [next[b], next[a]];
    value = next;
    build();
    emit();
  }

  build();
  wrap.getValue = () => value;
  return wrap;
}

function defaultValue(q) {
  if (q.type === 'mcq_multi') return [];
  if (q.type === 'matching') return (q.left || []).map(() => -1);
  if (q.type === 'ordering') return (q.items || []).map((_, i) => i);
  if (q.type === 'short_answer') return '';
  return null;
}

/* ---------- confidence -------------------------------------------------- */

/**
 * Tier buttons or a percentage dial, depending on the class's scoring rule.
 * Shows the points at stake as the student moves it, because the whole point
 * of asking for confidence is that the student feels the trade-off.
 */
export function confidenceWidget(q, settings, opts = {}) {
  const { onChange = () => {}, disabled = false } = opts;
  const calibrated = settings.rule === 'calibration';
  let value = opts.value ?? (calibrated ? 60 : 2);

  const wrap = el('div', { class: 'conf' });
  const payoff = el('div', { class: 'payoff' });

  const refreshPayoff = () => {
    const { best, worst } = preview(q, value, settings);
    payoff.textContent = '';
    payoff.append(
      el('span', { class: 'win', text: `right: +${best}` }),
      el('span', { class: 'lose', text: `wrong: ${worst > 0 ? '+' : ''}${worst}` })
    );
  };

  if (calibrated) {
    const pct = el('div', { class: 'pct', text: `${value}%` });
    const range = el('input', {
      type: 'range', min: '5', max: '99', step: '1', value: String(value), disabled,
      'aria-label': 'How sure are you, as a percentage',
      oninput: (e) => { value = Number(e.target.value); pct.textContent = `${value}%`; refreshPayoff(); onChange(value); }
    });
    wrap.className = 'conf conf-dial';
    wrap.append(
      pct,
      range,
      el('div', { class: 'legend' }, [
        el('span', { text: 'pure guess' }),
        el('span', { text: 'certain' })
      ])
    );
  } else {
    const tiers = el('div', { class: 'conf-tiers' });
    const paint = () => $$('.conf-tier', tiers).forEach((b, i) => b.classList.toggle('on', TIERS[i].level === value));
    TIERS.forEach((t) => {
      const b = el('button', {
        type: 'button', class: 'conf-tier', disabled,
        onclick: () => { value = t.level; paint(); refreshPayoff(); onChange(value); }
      }, [
        el('span', { class: 'lvl', text: t.label }),
        el('span', { class: 'risk', text: t.risk })
      ]);
      tiers.appendChild(b);
    });
    wrap.appendChild(tiers);
    paint();
  }

  wrap.appendChild(payoff);
  refreshPayoff();
  wrap.getValue = () => value;
  return wrap;
}

/* ---------- question header -------------------------------------------- */

export function questionMeta(q, extra = []) {
  const names = { 1: 'Warm-up', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Stretch' };
  const tone = q.difficulty >= 4 ? 'tag-rose' : q.difficulty <= 2 ? 'tag-jade' : 'tag-gold';
  return el('div', { class: 'qmeta' }, [
    el('span', { class: `tag ${tone}`, text: names[q.difficulty] || 'Medium' }),
    q.topic ? el('span', { class: 'tag', text: q.topic }) : null,
    el('span', { class: 'tag tag-violet', text: typeLabel(q.type) }),
    ...extra
  ]);
}

export function typeLabel(t) {
  return {
    true_false: 'True or false',
    mcq_single: 'One answer',
    mcq_multi: 'Several answers',
    matching: 'Matching',
    ordering: 'Ordering',
    short_answer: 'Written'
  }[t] || t;
}

/** Plain-language version of an answer, for result tables. */
export function describeAnswer(q, value) {
  if (value === null || value === undefined || value === '') return '—';
  switch (q.type) {
    case 'true_false': return String(value) === 'true' ? 'True' : 'False';
    case 'mcq_single': return `${LETTERS[value]}. ${(q.options || [])[value] ?? '?'}`;
    case 'mcq_multi': return (value || []).map((i) => LETTERS[i]).join(', ') || '—';
    case 'matching': return (value || []).map((j, i) => `${(q.left || [])[i]}→${(q.right || [])[j] ?? '?'}`).join('; ');
    case 'ordering': return (value || []).map((i) => (q.items || [])[i]).join(' · ');
    default: return String(value);
  }
}

/* ---------- sound ------------------------------------------------------- */

let audio = null;
function ctx() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

/** Short synthesised cues — no audio files to host. */
export const sfx = {
  enabled: true,
  tone(freq, dur = 0.12, type = 'sine', gain = 0.06, delay = 0) {
    if (!this.enabled) return;
    try {
      const c = ctx();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, c.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + delay); o.stop(c.currentTime + delay + dur);
    } catch { /* audio blocked until a click; harmless */ }
  },
  tick() { this.tone(880, 0.04, 'square', 0.03); },
  draw() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.05, i * 0.07)); },
  right() { [659, 880].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.07, i * 0.1)); },
  wrong() { this.tone(200, 0.28, 'sawtooth', 0.05); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.06, i * 0.13)); }
};

/* ---------- toast ------------------------------------------------------- */

let toastBox = null;
export function toast(message, tone = 'ok') {
  if (!toastBox) {
    toastBox = el('div', {});
    Object.assign(toastBox.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 60, alignItems: 'center'
    });
    document.body.appendChild(toastBox);
  }
  const bg = { ok: 'var(--ink)', bad: 'var(--rose)', warn: 'var(--gold)' }[tone] || 'var(--ink)';
  const t = el('div', { text: message });
  Object.assign(t.style, {
    background: bg, color: '#fff', padding: '10px 18px', borderRadius: '999px',
    fontSize: '0.9375rem', boxShadow: '0 10px 30px -12px rgba(0,0,0,.6)', maxWidth: '80vw'
  });
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
