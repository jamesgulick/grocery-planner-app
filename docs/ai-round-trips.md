# Optional: AI round trips

Three jobs can be handed to an AI chat that can read and return a file. All three work the same way, and none is required.

| Job | Where | What it does |
|---|---|---|
| **Calendar sync** | Data sheet, or Plan › Week | Fills each day's note from your calendar. Nothing else in the file changes. |
| **Add with AI** | Grab (the +) | Turns a recipe link or pasted recipe into a new meal with its details and ingredients, matched to items you already have. |
| **Fill in with AI** | A meal's page; Library › To finish | Fills in a meal's empty details from its recipe link, or from its name. |

## How it works

1. **① Send to AI** saves your data file and opens the share sheet. Send the file to your AI chat. A short prompt is already on the clipboard: *"Follow the request in the _meta node of the attached grocery planner file and send back the whole file."*
2. The file carries the request: `_meta.request` names the job (`calendar`, `recipe` or `enrich`) and its details, and `_meta.vocab` lists the values the app accepts.
3. When the chat sends the file back, open it and tap **② Re-import**. **Load this file?** shows every change before anything loads; nothing changes until you load it.

## Instructions for AI

**Settings › Instructions for AI** holds one short note per job, written into the file with each request. Use it to tell your chat how to do the job — which calendar to read, how to write the notes, or which saved instructions to follow if your AI tool supports them.

An example for Calendar sync:

> Read my calendar for each day of each plan in the file (from weekStartDate through endDate) and write each day's events into that plan's dayNotes as a short line, e.g. "8/20: Dentist 1:45pm · Practice 7:15pm". Change nothing else, and send back the whole file with the same name.

## Ground rules the app enforces

- If something on this device changed after the file was sent, the check lists what loading would drop, and **Load** becomes **Load anyway**.
- Only the job's own changes are expected: the check flags anything else.
- The app never sends anything by itself. Every trip starts with your tap and ends with your Load.
