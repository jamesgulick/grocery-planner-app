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
export function Row({ title, sub, value, onClick, trailing, chevron = !!onClick }) {
  const body = (
    <>
      <span className="ui-row-main"><span>{title}</span>{sub && <span className="ui-meta">{sub}</span>}</span>
      {value != null && <span className="ui-row-value">{value}</span>}
      {trailing}
      {chevron && <span className="ui-chevron"><Icon name="chevron" size={18} /></span>}
    </>
  );
  return onClick
    ? <button type="button" className="ui-row" onClick={onClick}>{body}</button>
    : <div className="ui-row ui-row-plain">{body}</div>;
}

// ── Buttons ───────────────────────────────────────────────────────────────────
export const PillButton = ({ children, onClick, secondary, inline, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className={`ui-pill ${secondary ? "ui-pill-secondary" : "ui-pill-primary"}${inline ? " ui-pill-inline" : ""}`}>{children}</button>
);
export const BlockButton = ({ children, onClick }) => <button type="button" className="ui-block-button" onClick={onClick}>{children}</button>;
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
export const Segmented = ({ options, value, onChange, label }) => (
  <div className="ui-seg" role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
);

// ── Sheet: grabber, title left, Done (or Cancel) right; tap outside or swipe down closes.
// `onBack` shows a back chevron for a page pushed inside the sheet.
export function Sheet({ title, onClose, onBack, doneLabel = "Done", children }) {
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
          <div className="ui-sheet-header">
            {onBack && <span className="ui-sheet-back"><IconButton icon="back" label="Back" onClick={onBack} /></span>}
            <h2 className="ui-heading">{title}</h2>
            <button type="button" className="ui-sheet-done" onClick={onClose}>{doneLabel}</button>
          </div>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </section>
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
export const TabBar = ({ tabs, active, onSelect }) => (
  <nav className="ui-tabbar" aria-label="Main">
    <div className="ui-tabbar-inner">
      {tabs.map(t => (
        <button key={t.id} type="button" className="ui-tab" aria-current={active === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
          <Icon name={t.icon} size={24} strong={active === t.id} />{t.label}
        </button>
      ))}
    </div>
  </nav>
);
export const TabBarSpacer = () => <div className="ui-tabbar-spacer" aria-hidden="true" />;

// ── Top bar for tabs other than Home ─────────────────────────────────────────
export const TopBar = ({ title, children }) => (
  <header className="ui-topbar"><h1 className="ui-heading">{title}</h1><div className="ui-icons">{children}</div></header>
);
