// Settings sheet (polish Phase 2; canvas board, to review): Household (Family, Away dates),
// Cooking (Grill season), Shopping (Plans start on), Calendar (Sync instructions: free text,
// written into every export's _meta for Send to Claude; never in the code), Help. No learn-mode switch (decided
// 11/12: the plate sheet's Reasons switch replaces it). Away dates and Help reuse today's
// editors inside the sheet until their own redraw.
import { useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { AwayPeriods } from "../manage/ManageConfig.jsx";
import { ManageHelp } from "../manage/ManageHelp.jsx";
import { Group, Row, Section, Sheet, Switch } from "../ui/kit.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsSheet({ db, persistDB, onClose }) {
  const [page, setPage] = useState("main");   // main | family | away | start | sync | help
  const [syncDraft, setSyncDraft] = useState(null);   // the instructions being edited
  const settings = db.settings || {};
  const upd = (k, v) => persistDB({ ...db, settings: { ...settings, [k]: v } });
  const family = settings.familyContacts || [];
  const ranges = settings.awayRanges || [];
  const today = todayLocalISO();
  const upcoming = ranges.filter(r => !r.to || r.to >= today).length;
  const back = () => setPage("main");

  // Sync instructions are saved when the page is left (back or close), not per keystroke.
  if (page === "sync") {
    const value = syncDraft ?? settings.syncInstructions ?? "";
    const save = then => () => {
      const text = value.trim() ? value : "";
      if (text !== (settings.syncInstructions || "")) {
        const next = { ...settings, syncInstructions: text };
        if (!text) delete next.syncInstructions;
        persistDB({ ...db, settings: next });
      }
      setSyncDraft(null); then();
    };
    return (
      <Sheet title="Sync instructions" onClose={save(onClose)} onBack={save(back)}>
        <textarea className="ui-textarea" aria-label="Sync instructions" value={value} onChange={e => setSyncDraft(e.target.value)} />
      </Sheet>
    );
  }

  if (page === "family") return (
    <Sheet title="Family" onClose={onClose} onBack={back}>
      <Group>{family.map(f => <Row key={f.name} title={f.name} />)}</Group>
    </Sheet>
  );
  if (page === "away") return (
    <Sheet title="Away dates" onClose={onClose} onBack={back}>
      <div className="shell-legacy"><AwayPeriods contacts={family} ranges={ranges} onChange={r => upd("awayRanges", r)} /></div>
    </Sheet>
  );
  if (page === "start") return (
    <Sheet title="Plans start on" onClose={onClose} onBack={back}>
      <Group>
        {WEEKDAYS.map(d => (
          <Row key={d} title={d} onClick={() => upd("shoppingDay", d)} chevron={false}
            trailing={settings.shoppingDay === d ? <span className="shell-check" aria-label="Selected">✓</span> : null} />
        ))}
      </Group>
    </Sheet>
  );
  if (page === "help") return (
    <Sheet title="Help" onClose={onClose} onBack={back}>
      <div className="shell-legacy"><ManageHelp /></div>
    </Sheet>
  );

  return (
    <Sheet title="Settings" onClose={onClose}>
      <Section label="Household">
        <Group>
          <Row title="Family" value={`${family.length} ${family.length === 1 ? "person" : "people"}`} onClick={() => setPage("family")} />
          <Row title="Away dates" value={upcoming ? `${upcoming} upcoming` : "None"} onClick={() => setPage("away")} />
        </Group>
      </Section>
      <Section label="Cooking">
        <Group>
          <Row title="Grill season" trailing={<Switch checked={!!settings.grillOpen} onChange={v => upd("grillOpen", v)} label="Grill season" />} />
        </Group>
      </Section>
      <Section label="Shopping">
        <Group><Row title="Plans start on" value={settings.shoppingDay || "Wednesday"} onClick={() => setPage("start")} /></Group>
      </Section>
      <Section label="Calendar">
        <Group><Row title="Sync instructions" value={settings.syncInstructions?.trim() ? "Set" : "Not set"} onClick={() => setPage("sync")} /></Group>
      </Section>
      <Group><Row title="Help" onClick={() => setPage("help")} /></Group>
    </Sheet>
  );
}
