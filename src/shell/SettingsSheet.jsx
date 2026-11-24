// Settings sheet (board "Settings, reviewed", Round 20; decided 11/16):
//   Planning: Usual shopping day ›, Grill season (switch)
//   Household: Family › (read-only), Away dates ›
//   Instructions for AI › (no heading: a group with one row gets none) — Calendar sync ·
//     Add a recipe · Fill in meals, each Set / Not set and a typed text box (Cancel · Done).
//     Free text kept on the device (settings.aiInstructions) and written into exports;
//     never in the code.
//   Help ›
import { useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { upcomingCount } from "../app/awayDates.js";
import { ManageHelp } from "../manage/ManageHelp.jsx";
import { Group, Row, Section, Sheet, Switch } from "../ui/kit.jsx";
import { AwayDates } from "./AwayDates.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// The labels match the buttons that send each one (decided 11/16); keys are the request purposes.
const AI_JOBS = [
  { key: "calendar", label: "Calendar sync" },
  { key: "recipe",   label: "Add a recipe" },
  { key: "enrich",   label: "Fill in meals" },
];

function InstructionEditor({ job, value, onCancel, onDone }) {
  const [text, setText] = useState(value);
  return (
    <Sheet title={job.label} onClose={onCancel} onCancel={onCancel} onDone={() => onDone(text.trim() ? text : "")}>
      <textarea className="ui-textarea" aria-label={job.label} value={text} onChange={e => setText(e.target.value)} />
    </Sheet>
  );
}

export function SettingsSheet({ db, persistDB, onClose }) {
  const [page, setPage] = useState("main");   // main | family | away | day | ai | ai:<key> | help
  const settings = db.settings || {};
  const upd = (k, v) => persistDB({ ...db, settings: { ...settings, [k]: v } });
  const family = settings.familyContacts || [];
  const upcoming = upcomingCount(settings.awayRanges || [], todayLocalISO());
  const ai = settings.aiInstructions || {};
  const isSet = key => !!(ai[key] || "").trim();
  const back = () => setPage("main");

  if (page.startsWith("ai:")) {
    const job = AI_JOBS.find(j => "ai:" + j.key === page);
    return (
      <InstructionEditor job={job} value={ai[job.key] || ""} onCancel={() => setPage("ai")}
        onDone={text => {
          if (text !== (ai[job.key] || "")) {
            const next = { ...ai, [job.key]: text };
            if (!text) delete next[job.key];
            upd("aiInstructions", next);
          }
          setPage("ai");
        }} />
    );
  }
  if (page === "ai") return (
    <Sheet tall title="Instructions for AI" onClose={onClose} onBack={back} backLabel="Settings">
      <Group>
        {AI_JOBS.map(j => <Row key={j.key} title={j.label} value={isSet(j.key) ? "Set" : "Not set"} onClick={() => setPage("ai:" + j.key)} />)}
      </Group>
    </Sheet>
  );
  if (page === "family") return (
    <Sheet tall title="Family" onClose={onClose} onBack={back} backLabel="Settings">
      <Group>{family.map(f => <Row key={f.name} title={f.name} />)}</Group>
    </Sheet>
  );
  if (page === "away") return <AwayDates db={db} persistDB={persistDB} onClose={onClose} onBack={back} />;
  if (page === "day") return (
    <Sheet tall title="Usual shopping day" onClose={onClose} onBack={back} backLabel="Settings">
      <Group>
        {WEEKDAYS.map(d => (
          <Row key={d} title={d} onClick={() => upd("shoppingDay", d)} chevron={false}
            trailing={settings.shoppingDay === d ? <span className="shell-check" aria-label="Selected">✓</span> : null} />
        ))}
      </Group>
    </Sheet>
  );
  if (page === "help") return (
    <Sheet tall title="Help" onClose={onClose} onBack={back} backLabel="Settings">
      <div className="shell-legacy"><ManageHelp /></div>
    </Sheet>
  );

  const setCount = AI_JOBS.filter(j => isSet(j.key)).length;
  return (
    <Sheet tall title="Settings" onClose={onClose}>
      <Section label="Planning">
        <Group>
          <Row title="Usual shopping day" value={settings.shoppingDay || "Wednesday"} onClick={() => setPage("day")} />
          <Row title="Grill season" trailing={<Switch checked={!!settings.grillOpen} onChange={v => upd("grillOpen", v)} label="Grill season" />} />
        </Group>
      </Section>
      <Section label="Household">
        <Group>
          <Row title="Family" value={`${family.length} ${family.length === 1 ? "person" : "people"}`} onClick={() => setPage("family")} />
          <Row title="Away dates" value={upcoming ? `${upcoming} upcoming` : "None"} onClick={() => setPage("away")} />
        </Group>
      </Section>
      <Group><Row title="Instructions for AI" value={`${setCount} of ${AI_JOBS.length} set`} onClick={() => setPage("ai")} /></Group>
      <Group><Row title="Help" onClick={() => setPage("help")} /></Group>
    </Sheet>
  );
}
