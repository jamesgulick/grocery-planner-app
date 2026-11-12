// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.

// ── Styles ─────────────────────────────────────────────────────────────────────

const C = {
  bg:"#F7F6F3", surface:"#FFFFFF", primary:"#1A3A2A", primaryLight:"#E8F5EE",
  accent:"#5AC987", accentMuted:"#7EC8A0", text:"#1A1A1A", muted:"#666",
  faint:"#999", border:"#E8E8E8", danger:"#B33333", dangerLight:"#FEE9E9",
  warning:"#B35F00", warningLight:"#FFF3E0", verified:"#1A7A3A",
};

const TIER_COLORS = {
  always:    { bg:"#E8F5EE", color:"#1A5C30" },
  staple:    { bg:"#EEF2FF", color:"#3730A3" },
  specialty: { bg:"#F3F4F6", color:"#374151" },
};

const EFFORT_COLORS = {
  easy:     { bg:"#E8F5EE",      color:"#1A5C30"  },
  medium:   { bg:C.warningLight, color:C.warning  },
  involved: { bg:C.dangerLight,  color:C.danger   },
};

const S = {
  app:         { fontFamily:"var(--font)", background:C.bg, minHeight:"100vh", maxWidth:"100%", margin:"0 auto", color:C.text, paddingBottom:80 },
  header:      { background:C.primary, color:"#E8F5EE", padding:"12px 16px 0", position:"sticky", top:0, zIndex:10 },
  headerTop:   { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 },
  headerTitle: { fontSize:16, fontWeight:700 },
  statusAction: { background:"rgba(255,255,255,0.92)", border:"none", color:C.primary, fontSize:11, fontWeight:700, padding:"5px 10px", borderRadius:8, cursor:"pointer", whiteSpace:"nowrap" },
  statusActionSubtle: { background:"transparent", border:"1px solid rgba(232,245,238,0.3)", color:C.accentMuted, fontSize:11, fontWeight:600, padding:"3px 9px", borderRadius:7, cursor:"pointer", whiteSpace:"nowrap" },
  tabs:        { display:"flex" },
  tab: a => ({ flex:1, padding:"9px 2px", textAlign:"center", fontSize:11, fontWeight:700, color:a?"#fff":C.accentMuted, borderBottom:a?"2px solid #fff":"2px solid transparent", cursor:"pointer", background:"none", border:"none" }),
  body:        { padding:"16px 16px 20px" },
  card:        { background:C.surface, borderRadius:14, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" },
  cardFlat:    { background:C.surface, borderRadius:14, marginBottom:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" },
  sectionLabel:{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:C.accentMuted, marginBottom:6 },
  h2:          { fontSize:20, fontWeight:700, marginBottom:4 },
  sub:         { fontSize:14, color:C.muted, lineHeight:1.5, marginBottom:12 },
  row:         { display:"flex", alignItems:"center", padding:"11px 16px", borderBottom:`1px solid ${C.border}`, gap:10 },
  rowLast:     { borderBottom:"none" },
  label:       { fontSize:13, fontWeight:600, color:C.muted, marginBottom:4, display:"block" },
  input:       { width:"100%", padding:"11px 13px", borderRadius:10, border:`1.5px solid ${C.border}`, fontSize:15, background:"#FAFAFA", boxSizing:"border-box", outline:"none", color:C.text },
  select:      { width:"100%", padding:"11px 13px", borderRadius:10, border:`1.5px solid ${C.border}`, fontSize:15, background:"#FAFAFA", boxSizing:"border-box", outline:"none", color:C.text },
  btn:         { display:"block", width:"100%", padding:"13px 16px", borderRadius:12, border:"none", fontSize:15, fontWeight:600, cursor:"pointer", textAlign:"center", marginBottom:8, touchAction:"manipulation", WebkitTapHighlightColor:"rgba(0,0,0,0.1)" },
  btnP:        { background:C.primary, color:"#fff" },
  btnS:        { background:C.primaryLight, color:C.primary },
  btnD:        { background:C.dangerLight, color:C.danger },
  btnSm:       { padding:"7px 12px", borderRadius:8, border:"none", fontSize:13, fontWeight:600, cursor:"pointer" },
  badge:  (color, bg) => ({ display:"inline-block", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:20, background:bg, color, marginRight:4 }),
  toggle: on  => ({ width:46, height:26, borderRadius:13, background:on?C.primary:"#DDD", position:"relative", cursor:"pointer", flexShrink:0, border:"none", transition:"background 0.2s" }),
  toggleDot: on => ({ position:"absolute", top:3, left:on?23:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }),
  checkBox: on => ({ width:24, height:24, borderRadius:6, border:on?"none":`2px solid ${C.border}`, background:on?C.primary:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#fff", fontSize:13, cursor:"pointer", transition:"all 0.15s" }),
  pill: a  => ({ padding:"6px 14px", borderRadius:20, border:`1.5px solid ${a?C.primary:C.border}`, background:a?C.primaryLight:"#fff", color:a?C.primary:C.muted, fontSize:13, fontWeight:600, cursor:"pointer" }),
  mealCard: effort => ({ background:effort==="easy"?"#F0FAF4":"#fff", border:effort==="easy"?`1.5px solid #B8E8CA`:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:10 }),
  tag: (color, bg) => ({ display:"inline-block", fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20, background:bg||C.primaryLight, color:color||C.primary, marginLeft:4 }),
};

export { C, EFFORT_COLORS, S, TIER_COLORS };
