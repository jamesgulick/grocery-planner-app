// Primitives (polish Phase 2, SPEC §4): each built when the first screen needs it. Styled
// only by class names in ui.css, which reads tokens.css; the lint rule bans raw colours
// and sizes here. Real <button>s wherever something can be acted on.
import React, { useEffect, useRef, useState } from "react";

// ── Icons: inline stroke SVG, currentColor ────────────────────────────────────
const PATHS = {
  home:     <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  plan:     <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  library:  <><path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M19 17v4H6" /></>,
  data:     <><path d="M7 20V4" /><path d="M3 8l4-4 4 4" /><path d="M17 4v16" /><path d="M13 16l4 4 4-4" /></>,   /* import and export: opposing arrows */
  gear:     <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  share:    <><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M12 3v12" /><path d="M8 7l4-4 4 4" /></>,
  print:    <><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 17h10v4H7z" /></>,
  chevron:  <path d="M9 6l6 6-6 6" />,
  back:     <path d="M15 6l-6 6 6 6" />,
  info:     <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.5" /></>,
  pencil:   <><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></>,
  sort:     <><path d="M4 7h16" /><path d="M4 12h11" /><path d="M4 17h6" /></>,   /* three shortening lines = sort */
  search:   <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  close:    <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  plus:     <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  down:     <><path d="M12 4v14" /><path d="M6 12l6 6 6-6" /></>,   /* Import (Data sheet) */
  up:       <><path d="M12 20V6" /><path d="M6 12l6-6 6 6" /></>,   /* Back up (Data sheet) */
  trash:    <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M9 7V4h6v3" /></>,
  cart:     <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6.1" /></>,   /* pickup: groceries arrive this day */
};

export function Icon({ name, size = 22, strong = false }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strong ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
  );
}

// ── Text ──────────────────────────────────────────────────────────────────────
export const ScreenTitle  = ({ children }) => <h1 className="ui-screen-title">{children}</h1>;
export const SectionLabel = ({ children, id }) => <div className="ui-section-label" id={id}>{children}</div>;

// ── Grouped list + row ───────────────────────────────────────────────────────
export const Section = ({ label, children }) => (
  <section className="ui-section">{label && <SectionLabel>{label}</SectionLabel>}{children}</section>
);
export const Group = ({ children }) => <div className="ui-group">{children}</div>;

// A row that opens something is a button with a chevron; one with a trailing control
// (a switch) is a plain row whose control takes the tap.
// The row chevron (decided 11/14): one fixed 8×14 icon at the row's right edge, centred on
// a single-line row and on the first line of a multi-line one (`top`). An inline chevron
// after a link word is a text "›" instead, styled by the screen.
export const RowChevron = ({ top }) => (
  <span className={top ? "ui-chevron ui-chevron-top" : "ui-chevron"}>
    <svg aria-hidden="true" className="ui-chevron-icon" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
  </span>
);

// `dim`: a row that's past (an ended away stretch) reads in the muted colour.
export function Row({ title, sub, value, onClick, trailing, dim, strong, problem, chevron = !!onClick }) {
  const body = (
    <>
      <span className="ui-row-main"><span className={strong ? "ui-strong" : undefined}>{title}</span>{sub && <span className={problem ? "ui-meta ui-problem" : "ui-meta"}>{sub}</span>}</span>
      {value != null && <span className="ui-row-value">{value}</span>}
      {trailing}
      {chevron && <RowChevron top={!!sub} />}
    </>
  );
  return onClick
    ? <button type="button" className={dim ? "ui-row ui-row-dim" : "ui-row"} onClick={onClick}>{body}</button>
    : <div className={dim ? "ui-row ui-row-plain ui-row-dim" : "ui-row ui-row-plain"}>{body}</div>;
}

// ── Buttons ───────────────────────────────────────────────────────────────────
export const PillButton = ({ children, onClick, secondary, inline, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className={`ui-pill ${secondary ? "ui-pill-secondary" : "ui-pill-primary"}${inline ? " ui-pill-inline" : ""}`}>{children}</button>
);
// A disabled filled button is grey (buttons rule, 11/15).
export const BlockButton = ({ children, onClick, disabled }) => <button type="button" className="ui-block-button" disabled={disabled} onClick={onClick}>{children}</button>;
// Full-width outlined button: the second action (three-button rule, 11/15).
export const OutlineButton = ({ children, onClick, disabled }) => <button type="button" className="ui-block-button ui-block-outline" disabled={disabled} onClick={onClick}>{children}</button>;
// Deleting a whole record: the one place red is used (destructive #B42318).
// `filled`: the speed bump's own Delete (filled red); the page's button is outlined.
export const DeleteButton = ({ children, onClick, filled }) => (
  <button type="button" className={filled ? "ui-block-button ui-block-delete ui-block-delete-filled" : "ui-block-button ui-block-delete"} onClick={onClick}>{!filled && <Icon name="trash" size={20} />}{children}</button>
);

// ── ⓘ: opens a short sheet explaining a field (one icon, one meaning) ────────────
export const InfoButton = ({ label, onClick }) => (
  <button type="button" className="ui-info" aria-label={"About " + label} onClick={onClick}><Icon name="info" size={18} /></button>
);
// A section label with an optional ⓘ, aligned with the card edge.
export const FieldLabel = ({ children, onInfo, info }) => (
  <div className="ui-section-label ui-field-label">{children}{onInfo && <InfoButton label={info || "this"} onClick={onInfo} />}</div>
);

// ── Check box (square; the move sheet's) and a row built on it ─────────────────
export const CheckBox = ({ on }) => <span className="ui-checkbox" aria-hidden="true" data-on={on ? "1" : "0"}>{on && "✓"}</span>;
export const CheckRow = ({ on, onClick, children, sub, strong }) => (
  <button type="button" role="checkbox" aria-checked={!!on} className="ui-row ui-check-row" onClick={onClick}>
    <CheckBox on={on} />
    <span className="ui-row-main"><span className={strong ? "ui-strong" : undefined}>{children}</span>{sub && <span className="ui-meta">{sub}</span>}</span>
  </button>
);

// ── Search field: 44 tall, border included ────────────────────────────────────
export const SearchField = ({ value, onChange, placeholder }) => (
  <label className="ui-search">
    <Icon name="search" size={18} />
    <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={e => onChange(e.target.value)} />
    {value && <button type="button" className="ui-search-clear" aria-label="Clear" onClick={() => onChange("")}><Icon name="close" size={16} /></button>}
  </label>
);

// ── Sort button: shows the current order; opens a short menu with a check ───────
export function SortMenu({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o.value === value) || options[0];
  return (
    <div className="ui-sort">
      <button type="button" className="ui-sort-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="sort" size={18} />{cur.label}
      </button>
      {open && <>
        <div className="ui-sort-scrim" onClick={() => setOpen(false)} />
        <div className="ui-sort-menu" role="menu">
          {options.map(o => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className="ui-sort-item"
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>{o.value === value && <span className="shell-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

// ── Time clocks: three clock faces, n of them filled (Decisions 11/14; the same icon as
// Week › Time, board "Plan, week: time"). Filled faces take the text colour; hands are cut
// out in the surface colour; the rest are the pale "off" grey.
export const Clocks = ({ n }) => (
  <svg aria-hidden="true" className="ui-clocks" viewBox="0 0 34 10">
    {[5, 17, 29].map((x, k) => (
      <g key={x}>
        <circle cx={x} cy="5" r="4.5" className={k < n ? "ui-clock-on" : "ui-clock-off"} />
        <path d={`M${x} 5V2.4M${x} 5h2`} className="ui-clock-hand" />
      </g>
    ))}
  </svg>
);

// ── Chips: multi-select tags and people (on = pale green + ✓, off = white outline) ──
export const Chip = ({ on, onClick, children }) => (
  <button type="button" className="ui-chip" aria-pressed={!!on} onClick={onClick}>{on && <span aria-hidden="true">✓</span>}{children}</button>
);

// ── A labelled field in a typed sheet ────────────────────────────────────────
export const Field = ({ label, children }) => (
  <div className="ui-field">{label && <div className="ui-section-label">{label}</div>}{children}</div>
);

export const IconButton = ({ icon, label, onClick, dot }) => (
  <button type="button" className="ui-icon-button" aria-label={label} onClick={onClick}>
    <Icon name={icon} />{dot && <span className="ui-dot" aria-hidden="true" />}
  </button>
);

// ── Switch: the only binary control ──────────────────────────────────────────
export const Switch = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className="ui-switch" onClick={() => onChange(!checked)} />
);

// ── Segmented choice ─────────────────────────────────────────────────────────
export const Segmented = ({ options, value, onChange, label, tone }) => (
  <div className={tone === "forest" ? "ui-seg ui-seg-forest" : "ui-seg"} role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}{o.dot && <span className="ui-seg-dot" aria-label="Something to finish" />}</button>)}
  </div>
);

// ── Sheet: grabber, title left, Done (or Cancel) right; tap outside or swipe down closes.
// `onBack` shows a back chevron for a page pushed inside the sheet; with `backLabel` it is the
// green "‹ Settings" line above the title instead (board "Settings, reviewed").
// `onCancel`: a typed sheet (Cancel · Done); `doneDisabled` greys Done out.
// `sub` is a line under the title; `footer` is pinned under the scrolling body (a primary action).
// `onInfo`: an ⓘ after the title, for a sheet that is one field (Who eats it, How often).
export function Sheet({ title, sub, onClose, onBack, backLabel, onCancel, onDone, doneDisabled, doneLabel = "Done", footer, onInfo, children }) {
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const onTouchStart = e => { start.current = e.touches[0].clientY; };
  const onTouchMove  = e => { if (start.current != null) setDrag(Math.max(0, e.touches[0].clientY - start.current)); };
  const onTouchEnd   = () => { if (drag > 80) onClose(); setDrag(0); start.current = null; };
  return (
    <div className="ui-sheet-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className="ui-sheet" style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="ui-sheet-grabber" aria-hidden="true" />
          {onBack && backLabel && (
            <button type="button" className="ui-sheet-backlink" onClick={onBack}><span aria-hidden="true">‹</span> {backLabel}</button>
          )}
          <div className="ui-sheet-header">
            {onBack && !backLabel && <span className="ui-sheet-back"><IconButton icon="back" label="Back" onClick={onBack} /></span>}
            {sub ? <div className="ui-sheet-titles"><h2 className="ui-heading">{title}</h2><span className="ui-meta">{sub}</span></div>
              : onInfo ? <div className="ui-sheet-titles ui-sheet-title-info"><h2 className="ui-heading">{title}</h2><InfoButton label={title} onClick={onInfo} /></div>
              : <h2 className="ui-heading">{title}</h2>}
            {onCancel && <button type="button" className="ui-sheet-done ui-sheet-cancel" onClick={onCancel}>Cancel</button>}
            <button type="button" className="ui-sheet-done" disabled={doneDisabled} onClick={onDone || onClose}>{doneLabel}</button>
          </div>
        </div>
        <div className="ui-sheet-body">{children}</div>
        {footer && <div className="ui-sheet-footer">{footer}</div>}
      </section>
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
// Bottom nav (board "Tab highlight", option F3, 11/20; capsule grey 11/22): a floating white
// capsule with the tabs (icon and label); the current one sits in a grey capsule that slides
// between tabs. An `action` (the +) is its own round button to the right of the capsule.
// The bar's distance from the screen's bottom (--tabbar-clear) is pure CSS, safe area
// included, so pinned pills and the page padding sit above it in the same frame. It is not
// measured: an iPhone Home Screen app resumed from the background reports a stale
// window.innerHeight, which left the pills over the bar or too high (11/23).
export function TabBar({ tabs, active, onSelect, action }) {
  const index = Math.max(0, tabs.findIndex(t => t.id === active));
  return (
    <nav className="ui-tabbar" aria-label="Main">
      <div className="ui-tabbar-inner">
        <div className="ui-tabbar-capsule" style={{ "--tab-count": tabs.length, "--tab-index": index }}>
          <span className="ui-tab-glide" aria-hidden="true" />
          {tabs.map(t => (
            <button key={t.id} type="button" className="ui-tab" aria-current={active === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
              <Icon name={t.icon} size={24} strong={active === t.id} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        {action && (
          <button type="button" className="ui-tab-plus" aria-label={action.label} onClick={action.onClick}>
            <Icon name="plus" size={26} strong />
          </button>
        )}
      </div>
    </nav>
  );
}
export const TabBarSpacer = () => <div className="ui-tabbar-spacer" aria-hidden="true" />;

// ── Sticky action bar: pinned just above the tab bar, translucent like it (decided 11/11).
// The screen leaves room for it at the end of its content.
export const ActionBar = ({ children }) => (
  <div className="ui-actionbar"><div className="ui-actionbar-inner">{children}</div></div>
);

// ── Top bar for tabs other than Home ─────────────────────────────────────────
// Header buttons (board "Header buttons", T3, 11/22): data and settings share one white capsule.
export const HeaderButtons = ({ children }) => <div className="ui-header-capsule">{children}</div>;
export const TopBar = ({ title, children }) => (
  <header className="ui-topbar"><h1 className="ui-heading">{title}</h1><div className="ui-icons">{children}</div></header>
);
