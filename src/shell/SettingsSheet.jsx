// Settings sheet (polish Phase 2; canvas board, to review): Household (Family, Away dates),
// Cooking (Grill season), Shopping (Plans start on), Help. No learn-mode switch (decided
// 11/12: the plate sheet's Reasons switch replaces it). Away dates and Help reuse today's
// editors inside the sheet until their own redraw.
import { useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { AwayPeriods } from "../manage/ManageConfig.jsx";
import { ManageHelp } from "../manage/ManageHelp.jsx";
import { Group, Row, Section, Sheet, Switch } from "../ui/kit.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsSheet({ db, persistDB, onClose }) {
  const [page, setPage] = useState("main");   // main | family | away | start | help
  const settings = db.settings || {};
  const upd = (k, v) => persistDB({ ...db, settings: { ...settings, [k]: v } });
  const family = settings.familyContacts || [];
  const ranges = settings.awayRanges || [];
  const today = todayLocalISO();
  const upcoming = ranges.filter(r => !r.to || r.to >= today).length;
  const back = () => setPage("main");

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
      <Group><Row title="Help" onClick={() => setPage("help")} /></Group>
    </Sheet>
  );
}
