"""Street-cleaning operations dashboard (simulated fleet).

    streamlit run street_cleaner/dashboard/app.py

Shows depots and their robots, which streets in each robot's zone are cleaned
or still to do, robot health and maintenance, and tickets for cars parked on
streets scheduled for cleaning, routed to the right department.
"""
import sys
import time
from datetime import timedelta
from pathlib import Path

import pandas as pd
import pydeck as pdk
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from street_cleaner.fleet.simulator import (SHIFT_END, SHIFT_START, FleetSim, health_score,  # noqa: E402
                                            robot_issues)
from street_cleaner.fleet.tickets import DEPARTMENTS, KIND_LABELS, ROUTING, mask_plate  # noqa: E402

st.set_page_config(page_title="Street Cleaner Ops", page_icon="🧹", layout="wide")

# ---------------------------------------------------------------- colours (status palette)
GOOD, WARN, SERIOUS, CRIT = "#0ca30c", "#fab219", "#ec835a", "#d03b3b"
BLUE, LIGHT_BLUE, GREY, INK = "#2a78d6", "#86b6ef", "#b5b3ab", "#0b0b0b"
VIOLET, MAGENTA = "#6250d6", "#e87ba4"

STREET_COLORS = {
    "Cleaned": GOOD,
    "Cleaning now": BLUE,
    "Partly cleaned": WARN,
    "To clean": WARN,
    "Waiting - robot down": CRIT,
    "Not scheduled today": GREY,
}
STREET_ORDER = list(STREET_COLORS)
ROBOT_STATES = {
    "cleaning": ("Cleaning", BLUE),
    "travelling": ("On the way", LIGHT_BLUE),
    "returning": ("Returning", WARN),
    "charging": ("Charging", GOOD),
    "docked": ("At depot", GREY),
    "maintenance": ("Maintenance", CRIT),
}
SEVERITY = {"critical": (CRIT, "⛔"), "serious": (SERIOUS, "⚠️"), "warning": (WARN, "⚠️"),
            "good": (GOOD, "✅"), "info": (GREY, "•")}


def rgb(hex_, a=255):
    h = hex_.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)] + [a]


st.markdown("""
<style>
.block-container{padding-top:1.6rem}
.rrow{padding:7px 0 6px;border-top:1px solid rgba(137,135,129,.25);font-size:.86rem;line-height:1.35}
.rrow:first-of-type{border-top:none}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}
.pill{font-size:.72rem;padding:0 8px;border-radius:999px;border:1.5px solid;margin-left:6px;white-space:nowrap}
.muted{color:#898781}
.bar{height:6px;background:rgba(137,135,129,.22);border-radius:3px;overflow:hidden;margin-top:4px}
.bar>div{height:100%;border-radius:3px}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.8rem;margin:.3rem 0 .2rem}
.sw{display:inline-block;width:18px;height:5px;border-radius:2px;vertical-align:middle;margin-right:6px}
.sd{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;margin-right:6px;border:2px solid #fff;box-shadow:0 0 0 1px #c3c2b7}
.ev{font-size:.82rem;padding:2px 0}
.plate{display:inline-block;border:2px solid #52514e;border-radius:6px;padding:6px 18px 4px;background:#fcfcfb;
       color:#0b0b0b;font:600 1.6rem/1.1 ui-monospace,Consolas,monospace;letter-spacing:.12em;text-align:center}
.plate small{display:block;font:500 .6rem/1 system-ui;letter-spacing:.2em;color:#52514e;margin-bottom:2px}
</style>
""", unsafe_allow_html=True)


# ---------------------------------------------------------------- state
def get_sim() -> FleetSim:
    if "sim" not in st.session_state:
        st.session_state.sim = FleetSim(outbox_path=ROOT / "logs" / "outbox.jsonl")
        st.session_state.last_tick = time.time()
    return st.session_state.sim


sim = get_sim()

with st.sidebar:
    st.subheader("🧹 Street Cleaner Ops")
    depot_opts = {"All depots": None} | {s.name: s.id for s in sim.stations.values()}
    depot_id = depot_opts[st.selectbox("Depot", list(depot_opts), key="depot")]
    live = st.toggle("Live simulation", value=True)
    speed = st.select_slider("Simulation speed", options=[10, 30, 60, 120, 300, 600], value=60,
                             format_func=lambda v: f"{v}×")
    st.caption(f"1 real second = {speed} simulated seconds" if speed < 60
               else f"1 real second = {speed // 60} simulated minute{'s' if speed > 60 else ''}")
    c1, c2 = st.columns(2)
    if c1.button("+15 min", width="stretch"):
        sim.step(15 * 60)
    if c2.button("Reset", width="stretch"):
        del st.session_state["sim"]
        st.rerun()
    sim.auto_forward = st.toggle("Auto-forward confident plate reads", value=True,
                                 help="Plate reads at 85% confidence or higher go straight to the department. "
                                      "Anything lower waits for a person.")
    masked = st.toggle("Mask licence plates", value=False, key="mask", help="For screenshots, videos and public screens.")
    st.divider()
    st.caption(f"**Simulated data** for the prototype. {sim.attribution}. Basemap © CARTO.")


def plate_txt(p):
    return mask_plate(p) if masked else p


def fmt_day(dt):
    if dt is None:
        return "-"
    if dt.date() == sim.today:
        return f"Today {dt:%H:%M}"
    if dt.date() == sim.today - timedelta(days=1):
        return f"Yesterday {dt:%H:%M}"
    return f"{dt:%a %d %b}"


# ---------------------------------------------------------------- body (re-runs every few seconds when live)
@st.fragment(run_every=3 if live else None)
def body():
    now = time.time()
    dt = min(now - st.session_state.last_tick, 10)
    st.session_state.last_tick = now
    if live:
        sim.step(dt * speed)

    robots = [r for r in sim.robots.values() if depot_id is None or r.station_id == depot_id]
    rids = {r.id for r in robots}
    streets = [s for s in sim.streets.values() if s.robot_id in rids]
    stations = [s for s in sim.stations.values() if depot_id is None or s.id == depot_id]
    status = {s.name: sim.street_status(s) for s in streets}
    issues = {r.id: robot_issues(r, sim.today) for r in robots}
    today_tix = [t for t in sim.book.tickets if t.created_at.date() == sim.today and t.robot_id in rids]

    # header + KPIs
    st.markdown(f"### Street cleaning operations · Halifax South End")
    shift = "in progress" if SHIFT_START <= sim.clock.hour < SHIFT_END else "over"
    st.caption(f"{sim.clock:%A %d %B %Y · %H:%M} (simulated) · cleaning shift {SHIFT_START:02d}:00-{SHIFT_END:02d}:00, {shift}"
               + ("" if live else " · paused"))

    sched = [s for s in streets if s.scheduled_today]
    cleaned = sum(s.done for s in sched)
    working = sum(r.state in ("cleaning", "travelling") for r in robots)
    needs_maint = [r for r in robots if r.state == "maintenance" or any(sev in ("critical", "serious") for sev, _ in issues[r.id])]
    review = [t for t in sim.book.tickets if t.status == "Needs review" and t.robot_id in rids]
    k = st.columns(5)
    k[0].metric("Streets cleaned", f"{cleaned} / {len(sched)}", border=True,
                help="Streets scheduled for today that robots have finished end to end.")
    k[1].metric("Robots working", f"{working} / {len(robots)}", border=True)
    k[2].metric("Need maintenance", len(needs_maint), border=True)
    k[3].metric("To review", len(review), border=True,
                help="Plate reads a person must confirm before they are sent.")
    k[4].metric("Debris today", f"{sum(r.debris_today for r in robots):.0f} kg", border=True)

    crit = [(r.id, txt) for r in robots for sev, txt in issues[r.id] if sev == "critical"]
    if crit:
        st.error("  \n".join(f"**{rid}** · {txt}" for rid, txt in crit[:4]), icon="⛔")

    tab_map, tab_health, tab_streets, tab_tix = st.tabs(
        ["🗺️ Map", "🔧 Robots & health", "🛣️ Streets", f"🎫 Tickets ({len(review)} to review)"])

    with tab_map:
        render_map(robots, streets, stations, status, today_tix)
    with tab_health:
        render_health(robots, issues)
    with tab_streets:
        render_streets(robots, streets, status)
    with tab_tix:
        render_tickets(rids)


# ---------------------------------------------------------------- map tab
def render_map(robots, streets, stations, status, today_tix):
    col_map, col_side = st.columns([2.3, 1], gap="medium")
    zones, paths, robot_pts, depot_pts, incidents = [], [], [], [], []
    for r in robots:
        poly = sim.zone_polygon(r.id)
        n = sum(1 for s in streets if s.robot_id == r.id)
        if poly:
            zones.append({"polygon": [list(p) for p in poly], "title": f"{r.id} zone",
                          "detail": f"{n} streets · {sim.stations[r.station_id].name}"})
    for s in streets:
        st_ = status[s.name]
        pct = 100 * s.progress / s.length
        detail = f"{st_} · {pct:.0f}% · {s.robot_id}"
        if st_ == "Not scheduled today":
            done, todo = [], s.pieces
            detail = f"Next clean {s.next_date:%a %d %b} · {s.robot_id}" if s.next_date else detail
        else:
            done, todo = s.split(s.progress)
        for p in done:
            paths.append({"path": [list(x) for x in p], "color": rgb(GOOD), "title": s.name, "detail": detail})
        for p in todo:
            paths.append({"path": [list(x) for x in p], "color": rgb(STREET_COLORS[st_]), "title": s.name, "detail": detail})
    for r in robots:
        label, color = ROBOT_STATES[r.state]
        where = r.current or sim.stations[r.station_id].name
        robot_pts.append({"pos": list(r.pos), "color": rgb(color), "label": r.id, "title": f"{r.id} · {label}",
                          "detail": f"{where} · battery {r.battery:.0f}% · health {health_score(r)}"})
    for stn in stations:
        here = sum(sim.robots[i].state in ("charging", "docked", "maintenance") for i in stn.robot_ids)
        depot_pts.append({"pos": list(stn.pos), "label": stn.name, "title": stn.name,
                          "detail": f"{len(stn.robot_ids)} robots · {here} at depot"})
    for t in today_tix:
        vehicle = t.kind in ("parked_during_cleaning", "suspected_abandoned")
        incidents.append({"pos": [t.lon, t.lat], "color": rgb(VIOLET if vehicle else MAGENTA),
                          "title": f"{KIND_LABELS[t.kind]} · {t.id}",
                          "detail": (f"{plate_txt(t.plate)} · {t.vehicle} · " if vehicle else f"{t.note} · ")
                          + f"{t.department} · {t.status}"})

    all_pts = [p for s in streets for piece in s.pieces for p in piece]
    view = pdk.ViewState(longitude=sum(p[0] for p in all_pts) / len(all_pts),
                         latitude=sum(p[1] for p in all_pts) / len(all_pts),
                         zoom=14.2 if depot_id is None else 15.3, pitch=0)
    layers = [
        pdk.Layer("PolygonLayer", zones, get_polygon="polygon", get_fill_color=[137, 135, 129, 22],
                  get_line_color=[137, 135, 129, 150], line_width_min_pixels=1, stroked=True, pickable=True),
        pdk.Layer("PathLayer", paths, get_path="path", get_color="color", width_min_pixels=5,
                  cap_rounded=True, joint_rounded=True, pickable=True),
        pdk.Layer("ScatterplotLayer", incidents, get_position="pos", get_fill_color="color", radius_min_pixels=6,
                  get_radius=1, stroked=True, get_line_color=[255, 255, 255], line_width_min_pixels=2, pickable=True),
        pdk.Layer("ScatterplotLayer", depot_pts, get_position="pos", get_fill_color=rgb(INK), radius_min_pixels=11,
                  get_radius=1, stroked=True, get_line_color=[255, 255, 255], line_width_min_pixels=3, pickable=True),
        pdk.Layer("TextLayer", depot_pts, get_position="pos", get_text="label", get_size=13, get_color=rgb(INK),
                  get_pixel_offset=[0, 22], background=True, get_background_color=[255, 255, 255, 230],
                  background_padding=[4, 2], font_weight=600),
        pdk.Layer("ScatterplotLayer", robot_pts, get_position="pos", get_fill_color="color", radius_min_pixels=8,
                  get_radius=1, stroked=True, get_line_color=[255, 255, 255], line_width_min_pixels=2.5, pickable=True),
        pdk.Layer("TextLayer", robot_pts, get_position="pos", get_text="label", get_size=11, get_color=rgb(INK),
                  get_pixel_offset=[0, -17], background=True, get_background_color=[255, 255, 255, 210],
                  background_padding=[3, 1]),
    ]
    tooltip = {"html": "<b>{title}</b><br/>{detail}",
               "style": {"backgroundColor": "#fcfcfb", "color": "#0b0b0b", "fontSize": "12px",
                         "border": "1px solid #e1e0d9", "borderRadius": "6px", "padding": "6px 8px"}}
    with col_map:
        st.pydeck_chart(pdk.Deck(layers=layers, initial_view_state=view, tooltip=tooltip, map_style=None),
                        height=580, key=f"map_{depot_id}")
        street_legend = "".join(f'<span><span class="sw" style="background:{c}"></span>{n}</span>'
                                for n, c in STREET_COLORS.items() if n != "Partly cleaned")
        robot_legend = "".join(f'<span><span class="sd" style="background:{c}"></span>{n}</span>'
                               for n, c in ROBOT_STATES.values())
        extra = (f'<span><span class="sd" style="background:{INK}"></span>Depot</span>'
                 f'<span><span class="sd" style="background:{VIOLET}"></span>Ticketed vehicle</span>'
                 f'<span><span class="sd" style="background:{MAGENTA}"></span>Dumping / road damage</span>')
        st.markdown(f'<div class="legend"><b>Streets</b>{street_legend}</div>'
                    f'<div class="legend"><b>Robots</b>{robot_legend}{extra}</div>', unsafe_allow_html=True)
        st.caption("Grey outlines are each robot's cleaning zone. Hover a street, robot or marker for details.")

    with col_side:
        for stn in stations:
            members = [sim.robots[i] for i in stn.robot_ids]
            out = sum(r.state in ("cleaning", "travelling", "returning") for r in members)
            with st.container(border=True):
                st.markdown(f"**{stn.name}** <span class='muted'>· {out} out · {len(members) - out} at depot</span>",
                            unsafe_allow_html=True)
                st.markdown("".join(robot_row(r) for r in members), unsafe_allow_html=True)
        st.markdown("**Live activity**")
        with st.container(height=230, border=True):
            evs = [e for e in reversed(sim.events) if e["robot"] in {r.id for r in robots}][:40]
            st.markdown("".join(
                f'<div class="ev"><span class="dot" style="background:{SEVERITY[e["severity"]][0]}"></span>'
                f'<span class="muted">{e["time"]:%H:%M}</span> <b>{e["robot"]}</b> {plate_mask_text(e["text"])}</div>'
                for e in evs) or "<span class='muted'>Nothing yet.</span>", unsafe_allow_html=True)


def plate_mask_text(text):
    if not masked:
        return text
    for v in sim.vehicles:
        text = text.replace(v["plate"], mask_plate(v["plate"]))
    return text


def robot_row(r):
    label, color = ROBOT_STATES[r.state]
    mine = [sim.streets[n] for n in r.queue if sim.streets[n].robot_id == r.id and sim.streets[n].scheduled_today]
    done = sum(s.done for s in mine)
    if r.state in ("cleaning", "travelling") and r.current:
        s = sim.streets[r.current]
        where = f"{s.name} · {100 * s.progress / s.length:.0f}%"
    elif r.state == "returning":
        where = r.return_reason
    elif r.state == "maintenance":
        where = (r.faults[0]["text"] if r.faults else "In maintenance bay")
    else:
        where = "Zone finished for today" if mine and done == len(mine) else "Waiting to go out"
    bat_c = GOOD if r.battery > 50 else (WARN if r.battery > 20 else CRIT)
    return (f'<div class="rrow"><span class="dot" style="background:{color}"></span><b>{r.id}</b>'
            f'<span class="pill" style="border-color:{color}">{label}</span>'
            f'<span class="muted" style="float:right">{done}/{len(mine)} streets</span>'
            f'<div class="muted">{where}</div>'
            f'<div class="bar"><div style="width:{max(r.battery, 0):.0f}%;background:{bat_c}"></div></div>'
            f'<div class="muted" style="font-size:.75rem">Battery {r.battery:.0f}% · bin {100 * r.bin_kg / 12:.0f}% · health {health_score(r)}</div>'
            f'</div>')


# ---------------------------------------------------------------- health tab
def render_health(robots, issues):
    rows = []
    for r in robots:
        rows.append({
            "Robot": r.id, "Depot": sim.stations[r.station_id].name, "Status": ROBOT_STATES[r.state][0],
            "Health": health_score(r), "Battery": round(r.battery), "Battery capacity": round(r.battery_capacity),
            "Brush wear": round(r.brush_wear), "Bin": round(100 * r.bin_kg / 12), "Camera clear": round(r.camera_clean),
            "Motor °C": round(r.motor_temp), "Last service": f"{(sim.today - r.last_service).days} days ago",
            "Odometer km": round(r.odometer_km),
            "Issues": " · ".join(t for _, t in issues[r.id]) or "OK",
        })
    pc = st.column_config.ProgressColumn
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", column_config={
        "Health": pc("Health", min_value=0, max_value=100, format="%d", help="100 = no wear or faults"),
        "Battery": pc("Battery", min_value=0, max_value=100, format="%d%%"),
        "Battery capacity": pc("Battery capacity", min_value=0, max_value=100, format="%d%%",
                               help="How much charge the battery still holds compared to new"),
        "Brush wear": pc("Brush wear", min_value=0, max_value=100, format="%d%%"),
        "Bin": pc("Bin", min_value=0, max_value=100, format="%d%%"),
        "Camera clear": pc("Camera clear", min_value=0, max_value=100, format="%d%%"),
        "Issues": st.column_config.TextColumn("Issues", width="large"),
    })

    st.markdown("#### Maintenance queue")
    queue = sorted([r for r in robots if issues[r.id] or r.state == "maintenance"], key=health_score)
    if not queue:
        st.success("All robots healthy.", icon="✅")
    for r in queue:
        with st.container(border=True):
            left, right = st.columns([2, 1.2])
            with left:
                label, color = ROBOT_STATES[r.state]
                st.markdown(f'<span class="dot" style="background:{color}"></span><b>{r.id}</b>'
                            f'<span class="pill" style="border-color:{color}">{label}</span>'
                            f'<span class="muted"> · health {health_score(r)} · {sim.stations[r.station_id].name}'
                            f'{" · " + r.note if r.note else ""}</span>', unsafe_allow_html=True)
                for sev, txt in issues[r.id]:
                    st.markdown(f"{SEVERITY[sev][1]} **{sev.title()}** · {txt}")
            with right:
                pending = [n for n in r.queue if sim.streets[n].robot_id == r.id
                           and sim.streets[n].scheduled_today and not sim.streets[n].done]
                b1, b2 = st.columns(2)
                if r.state != "maintenance" and not r.to_maintenance:
                    b1.button("Call in", key=f"in_{r.id}", width="stretch", on_click=sim.call_in, args=(r.id,),
                              help="Robot drives home and goes to the maintenance bay")
                elif r.to_maintenance:
                    b1.caption("Heading to bay")
                b2.button("Mark serviced", key=f"svc_{r.id}", width="stretch", type="primary",
                          on_click=sim.service, args=(r.id,),
                          help="Technician fixed the issues: brush, lens, faults (and battery if worn)")
                if pending and (r.state == "maintenance" or r.to_maintenance):
                    mates = [i for i in sim.stations[r.station_id].robot_ids
                             if i != r.id and sim.robots[i].state != "maintenance"]
                    if mates:
                        to = st.selectbox(f"Hand its {len(pending)} streets to", mates, key=f"to_{r.id}")
                        st.button("Reassign streets", key=f"re_{r.id}", width="stretch",
                                  on_click=sim.reassign, args=(r.id, to))


# ---------------------------------------------------------------- streets tab
def render_streets(robots, streets, status):
    pick = st.segmented_control("Show", ["All"] + STREET_ORDER, default="All", key="street_filter")
    rows = []
    for s in sorted(streets, key=lambda s: (STREET_ORDER.index(status[s.name]), s.name)):
        if pick not in (None, "All") and status[s.name] != pick:
            continue
        sched = (f"Today {SHIFT_START:02d}:00-{SHIFT_END:02d}:00" if s.scheduled_today
                 else f"Next: {s.next_date:%a %d %b}")
        rows.append({
            "Street": s.name, "Status": status[s.name], "Cleaned": round(100 * s.progress / s.length),
            "Robot": s.robot_id, "Depot": sim.stations[sim.robots[s.robot_id].station_id].name,
            "Length m": round(s.length), "Schedule": sched, "Last cleaned": fmt_day(s.last_cleaned),
            "Cars in the way": ", ".join(plate_txt(p) for _, p, _ in s.blocked) or "",
        })
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", column_config={
        "Cleaned": st.column_config.ProgressColumn("Cleaned", min_value=0, max_value=100, format="%d%%"),
        "Cars in the way": st.column_config.TextColumn(help="Spots the robot had to skip; each one has a ticket"),
    })

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("**Zone progress today** <span class='muted'>(% of scheduled street length cleaned)</span>",
                    unsafe_allow_html=True)
        zp = []
        for r in robots:
            mine = [s for s in streets if s.robot_id == r.id and s.scheduled_today]
            tot = sum(s.length for s in mine)
            zp.append({"Robot": r.id, "Cleaned %": round(100 * sum(s.progress for s in mine) / tot) if tot else 100})
        st.bar_chart(pd.DataFrame(zp), x="Robot", y="Cleaned %", color=BLUE, horizontal=True, height=280)
    with c2:
        st.markdown("**Streets cleaned per day** <span class='muted'>(whole network, last 7 days)</span>",
                    unsafe_allow_html=True)
        hist = [{"Day": h["date"].strftime("%a %d"), "Streets": h["streets_cleaned"]} for h in sim.history]
        hist.append({"Day": sim.today.strftime("%a %d") + " (today)",
                     "Streets": sum(s.done for s in sim.streets.values() if s.scheduled_today)})
        st.bar_chart(pd.DataFrame(hist), x="Day", y="Streets", color=BLUE, sort=False, height=280)


# ---------------------------------------------------------------- tickets tab
def render_tickets(rids):
    tix = [t for t in sim.book.tickets if t.robot_id in rids]
    today = [t for t in tix if t.created_at.date() == sim.today]
    k = st.columns(4)
    k[0].metric("Waiting for review", sum(t.status == "Needs review" for t in tix), border=True)
    k[1].metric("Forwarded today", sum(any("Forwarded" in h for _, h in t.history) for t in today), border=True)
    k[2].metric("Citations issued today", sum(t.status == "Citation issued" for t in today), border=True)
    k[3].metric("Dumping & road reports today", sum(t.kind in ("illegal_dumping", "road_damage") for t in today),
                border=True)

    view = st.segmented_control("Show", ["Needs action", "Today", "Last 7 days"], default="Today", key="tix_view")
    if view == "Needs action":
        shown = [t for t in tix if t.is_open]
    elif view == "Last 7 days":
        shown = tix
    else:
        shown = today
    shown = sorted(shown, key=lambda t: t.created_at, reverse=True)
    rows = [{"Ticket": t.id, "Seen": fmt_day(t.created_at), "Type": KIND_LABELS[t.kind],
             "Plate": plate_txt(t.plate) or "", "Read": round(100 * t.plate_conf) if t.plate_conf else None, "Vehicle": t.vehicle or t.note,
             "Street": t.street, "Robot": t.robot_id, "Sent to": t.department, "Status": t.status} for t in shown]
    if rows:
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", height=min(38 + 35 * len(rows), 360),
                     column_config={"Read": st.column_config.NumberColumn(
                         "Plate read", format="%d%%", help="Camera's confidence in the plate text")})
    else:
        st.info("No tickets in this view.")

    st.markdown("#### Ticket details")
    if not tix:
        return
    ordered = sorted(tix, key=lambda t: (not t.is_open, -t.created_at.timestamp()))
    ids = [t.id for t in ordered]
    by_id = {t.id: t for t in ordered}
    sel = st.selectbox("Ticket", ids, key="tix_sel",
                       format_func=lambda i: f"{i} · {KIND_LABELS[by_id[i].kind]} · {by_id[i].street}")
    t = by_id[sel]
    left, mid, right = st.columns([1.1, 1.3, 1.4], gap="medium")
    with left:
        if t.plate:
            st.markdown(f'<div class="plate"><small>LICENCE PLATE</small>{plate_txt(t.plate)}</div>',
                        unsafe_allow_html=True)
            st.caption(f"Read at {t.plate_conf:.0%} confidence. The robot's photo attaches here once the camera feed is connected.")
        st.markdown(f"**{KIND_LABELS[t.kind]}**  \n{t.vehicle or ''}{' · ' if t.vehicle and t.note else ''}{t.note}")
        st.markdown(f"📍 {t.street} · {t.lat:.5f}, {t.lon:.5f}  \n🤖 {t.robot_id} · {t.created_at:%a %d %b %H:%M}")
    with mid:
        st.markdown(f"**Routed to:** {t.department}  \n<span class='muted'>{DEPARTMENTS[ROUTING[t.kind]]['handles']}</span>",
                    unsafe_allow_html=True)
        st.markdown(f"**Status:** {t.status}")
        if t.status == "Needs review":
            why = ("Same car at the same spot on several checks: a person decides before By-law is called."
                   if t.kind == "suspected_abandoned" else
                   f"Plate read was only {t.plate_conf:.0%} sure. Check the photo and fix the plate if needed.")
            st.warning(why, icon="👀")
            if t.plate:
                st.text_input("Plate", value=t.plate, key=f"pl_{t.id}")
            a, b = st.columns(2)
            a.button("Confirm", key=f"ok_{t.id}", type="primary", width="stretch",
                     on_click=lambda: sim.confirm(t, st.session_state.get(f"pl_{t.id}") or t.plate or ""))
            b.button("Dismiss", key=f"no_{t.id}", width="stretch", on_click=sim.dismiss, args=(t, "rejected on review"))
        elif t.status == "Ready to forward":
            st.button(f"Forward to {t.department}", key=f"fw_{t.id}", type="primary", width="stretch",
                      on_click=sim.forward, args=(t,))
    with right:
        st.markdown("**History**")
        st.markdown("  \n".join(f"<span class='muted'>{fmt_day(w)}</span> {plate_mask_text(h)}" for w, h in t.history),
                    unsafe_allow_html=True)

    st.divider()
    r1, r2 = st.columns([1, 1.4], gap="medium")
    with r1:
        st.markdown("**Who gets what**")
        st.dataframe(pd.DataFrame([{"Report": KIND_LABELS[k], "Department": DEPARTMENTS[d]["name"]}
                                   for k, d in ROUTING.items()]), hide_index=True, width="stretch")
    with r2:
        st.markdown("**Outbox** <span class='muted'>(messages sent to departments, newest first; "
                    "also written to logs/outbox.jsonl)</span>", unsafe_allow_html=True)
        msgs = [m for m in reversed(sim.book.outbox) if m["robot"] in rids][:12]
        if msgs:
            st.dataframe(pd.DataFrame([{"Sent": m["sent_at"][11:], "Ticket": m["ticket"], "To": m["to"],
                                        "Plate": plate_txt(m["plate"]) or "", "Street": m["street"]} for m in msgs]),
                         hide_index=True, width="stretch")
        else:
            st.caption("Nothing sent yet.")


body()
