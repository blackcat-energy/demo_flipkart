import os
import json
import sqlite3
import math
from datetime import datetime
from pathlib import Path
from typing import Optional
import numpy as np
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from static_data import (
    CORRIDORS, ZONES, JUNCTIONS, POLICE_STATIONS,
    EVENT_CAUSE_MAP, EVENT_TYPE_MAP,
    JUNCTION_COORDS, CORRIDOR_CONNECTIONS
)

BASE_DIR = Path(__file__).parent

# ── Models ─────────────────────────────────────────────────────────────────
print("Loading ML models...")
priority_model = joblib.load(BASE_DIR / "models" / "priority_model.pkl")
closure_model  = joblib.load(BASE_DIR / "models" / "closure_model.pkl")
resolution_model = joblib.load(BASE_DIR / "models" / "resolution_model.pkl")
closure_threshold = joblib.load(BASE_DIR / "models" / "closure_threshold.pkl")
label_encoders = joblib.load(BASE_DIR / "models" / "label_encoders.pkl")
print(f"Models loaded. Closure threshold: {closure_threshold}")

# ── Hotspots ────────────────────────────────────────────────────────────────
with open(BASE_DIR / "hotspots.json") as f:
    HOTSPOTS = json.load(f)

# ── DB ───────────────────────────────────────────────────────────────────────
DB_PATH = BASE_DIR / "routegenie.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            event_cause_ui TEXT NOT NULL,
            corridor TEXT NOT NULL,
            zone TEXT NOT NULL,
            junction TEXT,
            police_station TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            event_date TEXT NOT NULL,
            event_hour INTEGER NOT NULL,
            crowd_estimate TEXT NOT NULL,
            risk_score REAL NOT NULL,
            priority_probability REAL NOT NULL,
            closure_predicted INTEGER NOT NULL,
            resolution_minutes REAL NOT NULL,
            recommendations_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'planned',
            actual_delay_minutes REAL,
            actual_closures INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()

    # Seed demo data if empty
    count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    if count == 0:
        seed_data = [
            {
                "event_name": "Dasara Procession 2024",
                "event_cause_ui": "Festival / Procession",
                "corridor": "CBD 1",
                "zone": "Central Zone 1",
                "junction": "KRCircleJunc",
                "police_station": "Cubbon Park",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "event_date": "2024-10-12",
                "event_hour": 17,
                "crowd_estimate": "10000+",
                "risk_score": 82.4,
                "priority_probability": 0.94,
                "closure_predicted": 1,
                "resolution_minutes": 187.0,
                "recommendations_json": json.dumps([
                    {"action": "Deploy 8 officers", "why": "Risk score of 82.4 indicates high disruption. Historical events at similar corridors required similar deployment."},
                    {"action": "Deploy barricades at corridor entry points", "why": "ML model predicts road closure is likely at CBD 1. Barricades will manage access."},
                    {"action": "Activate diversion route", "why": "High priority event probability (94%). Pre-emptive diversion reduces spillover to adjacent corridors."},
                    {"action": "Deploy monitoring unit at KRCircleJunc", "why": "Junction identified as high-vulnerability point based on historical incident density in this area."}
                ]),
                "status": "completed",
                "actual_delay_minutes": 210.0,
                "actual_closures": 1,
            },
            {
                "event_name": "Karnataka vs Mumbai IPL Match",
                "event_cause_ui": "Sports Event",
                "corridor": "ORR East 1",
                "zone": "East Zone 1",
                "junction": "HebbalFlyoverJunc",
                "police_station": "Whitefield",
                "latitude": 12.9283,
                "longitude": 77.6691,
                "event_date": "2024-11-18",
                "event_hour": 19,
                "crowd_estimate": "2000-10000",
                "risk_score": 67.2,
                "priority_probability": 0.88,
                "closure_predicted": 0,
                "resolution_minutes": 112.0,
                "recommendations_json": json.dumps([
                    {"action": "Deploy 5 officers", "why": "Risk score of 67.2 indicates moderate disruption. Historical events at similar corridors required similar deployment."},
                    {"action": "Activate diversion route", "why": "High priority event probability (88%). Pre-emptive diversion reduces spillover to adjacent corridors."},
                    {"action": "Deploy monitoring unit at HebbalFlyoverJunc", "why": "Junction identified as high-vulnerability point based on historical incident density in this area."}
                ]),
                "status": "completed",
                "actual_delay_minutes": 95.0,
                "actual_closures": 0,
            },
            {
                "event_name": "Tech Summit 2025 VIP Movement",
                "event_cause_ui": "VIP Movement",
                "corridor": "Bellary Road 1",
                "zone": "North Zone 1",
                "junction": "HebbalFlyoverJunc",
                "police_station": "Hebbala",
                "latitude": 13.0452,
                "longitude": 77.5971,
                "event_date": "2025-01-15",
                "event_hour": 10,
                "crowd_estimate": "500-2000",
                "risk_score": 55.8,
                "priority_probability": 0.78,
                "closure_predicted": 0,
                "resolution_minutes": 68.0,
                "recommendations_json": json.dumps([
                    {"action": "Deploy 5 officers", "why": "Risk score of 55.8 indicates moderate disruption."},
                    {"action": "Activate diversion route", "why": "High priority event probability (78%). Pre-emptive diversion reduces spillover."},
                    {"action": "Deploy monitoring unit at HebbalFlyoverJunc", "why": "Junction identified as high-vulnerability point."}
                ]),
                "status": "active",
                "actual_delay_minutes": None,
                "actual_closures": None,
            },
            {
                "event_name": "Metro Line 4 Construction",
                "event_cause_ui": "Construction",
                "corridor": "Tumkur Road",
                "zone": "West Zone 1",
                "junction": "PeenyaJunc",
                "police_station": "Peenya",
                "latitude": 13.0315,
                "longitude": 77.5337,
                "event_date": "2025-06-20",
                "event_hour": 8,
                "crowd_estimate": "< 500",
                "risk_score": 38.2,
                "priority_probability": 0.61,
                "closure_predicted": 0,
                "resolution_minutes": 240.0,
                "recommendations_json": json.dumps([
                    {"action": "Deploy 3 officers", "why": "Risk score of 38.2 indicates moderate disruption."},
                    {"action": "Deploy monitoring unit at PeenyaJunc", "why": "Junction identified as high-vulnerability point."}
                ]),
                "status": "active",
                "actual_delay_minutes": None,
                "actual_closures": None,
            },
        ]
        for row in seed_data:
            conn.execute("""
                INSERT INTO events
                (event_name, event_cause_ui, corridor, zone, junction, police_station,
                 latitude, longitude, event_date, event_hour, crowd_estimate,
                 risk_score, priority_probability, closure_predicted, resolution_minutes,
                 recommendations_json, status, actual_delay_minutes, actual_closures)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                row["event_name"], row["event_cause_ui"], row["corridor"], row["zone"],
                row.get("junction"), row.get("police_station"),
                row["latitude"], row["longitude"], row["event_date"], row["event_hour"],
                row["crowd_estimate"], row["risk_score"], row["priority_probability"],
                row["closure_predicted"], row["resolution_minutes"],
                row["recommendations_json"], row["status"],
                row.get("actual_delay_minutes"), row.get("actual_closures"),
            ))
        conn.commit()
        print("Seeded demo events")
    conn.close()

init_db()

# ── FastAPI ──────────────────────────────────────────────────────────────────
app = FastAPI(title="RouteGenie API", root_path="/api")

@app.middleware("http")
async def strip_api_prefix(request, call_next):
    if request.scope.get("path", "").startswith("/api/"):
        request.scope["path"] = request.scope["path"][4:]
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic Models ───────────────────────────────────────────────────────────
class PredictInput(BaseModel):
    event_cause_ui: str
    corridor: str
    zone: str
    junction: Optional[str] = None
    police_station: Optional[str] = None
    hour: int
    latitude: float
    longitude: float

class EventInput(BaseModel):
    event_name: str
    event_cause_ui: str
    corridor: str
    zone: str
    junction: Optional[str] = None
    police_station: Optional[str] = None
    latitude: float
    longitude: float
    event_date: str
    event_hour: int
    crowd_estimate: str
    risk_score: float
    priority_probability: float
    closure_predicted: bool
    resolution_minutes: float
    recommendations_json: str
    status: Optional[str] = "planned"

class EventUpdate(BaseModel):
    status: Optional[str] = None
    event_name: Optional[str] = None

class ReviewInput(BaseModel):
    actual_delay_minutes: float
    actual_closures: bool

# ── ML Inference ─────────────────────────────────────────────────────────────
def safe_encode(le, value: str) -> int:
    classes = list(le.classes_)
    if value in classes:
        return int(le.transform([value])[0])
    if "Unknown" in classes:
        return int(le.transform(["Unknown"])[0])
    return 0

def predict_event(
    event_cause_ui: str,
    corridor: str,
    zone: str,
    junction: Optional[str],
    police_station: Optional[str],
    hour: int,
    latitude: float,
    longitude: float,
):
    now = datetime.now()
    day_of_week = now.weekday()
    month = now.month
    is_weekend = int(day_of_week >= 5)
    is_peak = int((7 <= hour <= 10) or (17 <= hour <= 20))
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    dow_sin  = math.sin(2 * math.pi * day_of_week / 7)
    dow_cos  = math.cos(2 * math.pi * day_of_week / 7)

    event_cause = EVENT_CAUSE_MAP.get(event_cause_ui, "others")
    event_type  = EVENT_TYPE_MAP.get(event_cause_ui, "unplanned")
    junc = junction or "Unknown"
    ps   = police_station or "Unknown"

    # ── Priority (CatBoost) — raw string categoricals ──────────────────────
    cat_feat = pd.DataFrame([{
        "event_type": event_type,
        "event_cause": event_cause,
        "veh_type": "Unknown",
        "corridor": corridor,
        "zone": zone,
        "junction": junc,
        "police_station": ps,
        "latitude": latitude,
        "longitude": longitude,
        "hour": hour,
        "day_of_week": day_of_week,
        "month": month,
        "is_weekend": is_weekend,
        "is_peak": is_peak,
        "hour_sin": hour_sin,
        "hour_cos": hour_cos,
        "dow_sin": dow_sin,
        "dow_cos": dow_cos,
    }])
    priority_prob = float(priority_model.predict_proba(cat_feat)[0][1])

    # ── Closure + Resolution (LightGBM) — label-encoded ───────────────────
    le_map = label_encoders if isinstance(label_encoders, dict) else {}
    enc = {
        "event_type":     safe_encode(le_map["event_type"],     event_type)     if "event_type"     in le_map else 0,
        "event_cause":    safe_encode(le_map["event_cause"],    event_cause)    if "event_cause"    in le_map else 0,
        "veh_type":       safe_encode(le_map["veh_type"],       "Unknown")      if "veh_type"       in le_map else 0,
        "corridor":       safe_encode(le_map["corridor"],       corridor)       if "corridor"       in le_map else 0,
        "zone":           safe_encode(le_map["zone"],           zone)           if "zone"           in le_map else 0,
        "junction":       safe_encode(le_map["junction"],       junc)           if "junction"       in le_map else 0,
        "police_station": safe_encode(le_map["police_station"], ps)             if "police_station" in le_map else 0,
    }
    lgbm_feat = pd.DataFrame([{
        **enc,
        "latitude": latitude, "longitude": longitude,
        "hour": hour, "day_of_week": day_of_week, "month": month,
        "is_weekend": is_weekend, "is_peak": is_peak,
        "hour_sin": hour_sin, "hour_cos": hour_cos,
        "dow_sin": dow_sin, "dow_cos": dow_cos,
    }])

    closure_prob_raw = float(closure_model.predict_proba(lgbm_feat)[0][1])
    closure_predicted = closure_prob_raw >= float(closure_threshold)

    res_log = float(resolution_model.predict(lgbm_feat)[0])
    resolution_minutes = float(np.expm1(max(0.0, res_log)))
    resolution_minutes = max(5.0, min(resolution_minutes, 600.0))

    risk_score = round(
        0.40 * priority_prob * 100 +
        0.35 * closure_prob_raw * 100 +
        0.25 * min(resolution_minutes / 180.0, 1.0) * 100,
        1,
    )

    return {
        "priority_probability": round(priority_prob, 4),
        "closure_probability":  round(closure_prob_raw, 4),
        "closure_predicted":    bool(closure_predicted),
        "predicted_resolution_minutes": round(resolution_minutes, 1),
        "risk_score": risk_score,
    }

def risk_label(score: float) -> str:
    if score < 30:   return "Low disruption expected"
    if score < 50:   return "Moderate disruption expected"
    if score < 70:   return "High disruption expected"
    return "Critical disruption expected"

def duration_band(minutes: float) -> str:
    if minutes < 60:  return "Short disruption expected (under 1 hour)"
    if minutes < 180: return "Moderate disruption expected (1–3 hours)"
    return "Extended disruption expected (3+ hours)"

def generate_recommendations(risk_score, closure_predicted, priority_prob, resolution_minutes, corridor, junction, event_cause_ui):
    recs = []
    
    # 1. Personnel (Officers) deployment
    if risk_score >= 70:
        officers = 8
    elif risk_score >= 50:
        officers = 5
    elif risk_score >= 30:
        officers = 3
    else:
        officers = 1

    j_name = junction if (junction and junction != "Unknown") else "critical intersections"
    recs.append({
        "category": "Personnel",
        "action": f"Deploy {officers} traffic officers at {j_name}",
        "why": f"A risk score of {risk_score} and '{event_cause_ui}' cause maps to a {officers}-officer deployment tier. Officers should manage lane merges, manual signal overrides, and intersection spillback around {corridor}."
    })

    # 2. Infrastructure (Barricades) deployment
    if closure_predicted or risk_score >= 50:
        barricades = 4 if risk_score >= 70 else 2
        recs.append({
            "category": "Infrastructure",
            "action": f"Position {barricades} mobile barricades at {corridor} entry points",
            "why": f"ML model predicts a high road closure probability. Positioning {barricades} barricades will establish control checkpoints, filter emergency vehicles, and prevent unauthorized traffic from entering the active event zone."
        })
    elif event_cause_ui in ["Water Logging", "Construction"]:
        recs.append({
            "category": "Infrastructure",
            "action": f"Place hazard cones and lane-reduction signs",
            "why": f"'{event_cause_ui}' restricts lane availability. Visual hazard warnings are required 200m ahead to slow down vehicles and merge them safely into the single active lane."
        })

    # 3. Diversion Activation
    if priority_prob > 0.65 or closure_predicted:
        recs.append({
            "category": "Diversion",
            "action": f"Activate pre-emptive diversion routes around {corridor}",
            "why": f"With a high priority probability ({round(priority_prob*100)}%) or predicted closure, upstream detours should be activated at connected decision junctions to reduce queue spillover onto adjoining corridors."
        })

    # 4. Event-specific Operations
    if event_cause_ui == "Water Logging":
        recs.append({
            "category": "Traffic Control",
            "action": "Deploy high-capacity dewatering pumps and tow trucks",
            "why": "Water logging reduces corridor capacity by 70%. Standby pumps speed up drainage, while tow trucks ensure stalled vehicles are cleared immediately to prevent complete gridlock."
        })
    elif event_cause_ui in ["Accident", "Vehicle Breakdown"]:
        recs.append({
            "category": "Emergency",
            "action": "Deploy emergency response vehicle and clearing crew",
            "why": "Incidents cause temporary lane blocks. Rapid clearance within the first 15 minutes prevents queue formation from growing exponentially into spillover congestion."
        })
    elif event_cause_ui == "VIP Movement":
        recs.append({
            "category": "Security",
            "action": "Coordinate green-corridor signal phasing",
            "why": "VIP movements cause temporary moving blockages. Green-phasing minimizes the stop duration and flushes built-up traffic quickly after the VIP motorcade passes."
        })
    elif event_cause_ui in ["Festival / Procession", "Political Rally"]:
        recs.append({
            "category": "Public Safety",
            "action": "Establish moving safety escort units",
            "why": "Processions create a slow, moving blockage along the corridor. Escorts coordinate with control to open/close road segments dynamically as the crowd advances."
        })
        
    return recs

# ── Helpers ───────────────────────────────────────────────────────────────────
def row_to_dict(row) -> dict:
    d = dict(row)
    d["closure_predicted"] = bool(d["closure_predicted"])
    if d.get("actual_closures") is not None:
        d["actual_closures"] = bool(d["actual_closures"])
    return d

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/healthz")
def health():
    return {"status": "ok"}

@app.post("/predict")
def predict(body: PredictInput):
    try:
        result = predict_event(
            event_cause_ui=body.event_cause_ui,
            corridor=body.corridor,
            zone=body.zone,
            junction=body.junction,
            police_station=body.police_station,
            hour=body.hour,
            latitude=body.latitude,
            longitude=body.longitude,
        )
        recs = generate_recommendations(
            result["risk_score"],
            result["closure_predicted"],
            result["priority_probability"],
            result["predicted_resolution_minutes"],
            body.corridor,
            body.junction or "",
            body.event_cause_ui
        )
        
        # Query similar completed historical events from the SQLite DB
        conn = get_db()
        similar_rows = conn.execute("""
            SELECT event_name, event_date, resolution_minutes, closure_predicted, actual_delay_minutes, actual_closures, event_cause_ui, corridor
            FROM events
            WHERE (corridor = ? OR event_cause_ui = ?) AND status = 'completed'
            LIMIT 3
        """, (body.corridor, body.event_cause_ui)).fetchall()
        conn.close()
        
        similar_events = []
        for r in similar_rows:
            d = dict(r)
            d["closure_predicted"] = bool(d["closure_predicted"])
            if d.get("actual_closures") is not None:
                d["actual_closures"] = bool(d["actual_closures"])
            similar_events.append(d)

        return {
            **result,
            "risk_label": risk_label(result["risk_score"]),
            "duration_band": duration_band(result["predicted_resolution_minutes"]),
            "recommendations": recs,
            "similar_historical_events": similar_events
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/events")
def list_events(status: Optional[str] = None, corridor: Optional[str] = None, event_cause_ui: Optional[str] = None):
    conn = get_db()
    query = "SELECT * FROM events WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"; params.append(status)
    if corridor:
        query += " AND corridor = ?"; params.append(corridor)
    if event_cause_ui:
        query += " AND event_cause_ui = ?"; params.append(event_cause_ui)
    query += " ORDER BY created_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]

@app.post("/events", status_code=201)
def create_event(body: EventInput):
    conn = get_db()
    cur = conn.execute("""
        INSERT INTO events
        (event_name, event_cause_ui, corridor, zone, junction, police_station,
         latitude, longitude, event_date, event_hour, crowd_estimate,
         risk_score, priority_probability, closure_predicted, resolution_minutes,
         recommendations_json, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        body.event_name, body.event_cause_ui, body.corridor, body.zone,
        body.junction, body.police_station,
        body.latitude, body.longitude, body.event_date, body.event_hour,
        body.crowd_estimate, body.risk_score, body.priority_probability,
        int(body.closure_predicted), body.resolution_minutes,
        body.recommendations_json, body.status or "planned",
    ))
    conn.commit()
    row = conn.execute("SELECT * FROM events WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)

@app.get("/events/{event_id}")
def get_event(event_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return row_to_dict(row)

@app.put("/events/{event_id}")
def update_event(event_id: int, body: EventUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Event not found")
    if body.status is not None:
        conn.execute("UPDATE events SET status=? WHERE id=?", (body.status, event_id))
    if body.event_name is not None:
        conn.execute("UPDATE events SET event_name=? WHERE id=?", (body.event_name, event_id))
    conn.commit()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    conn.close()
    return row_to_dict(row)

@app.put("/events/{event_id}/review")
def review_event(event_id: int, body: ReviewInput):
    conn = get_db()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Event not found")
    conn.execute(
        "UPDATE events SET actual_delay_minutes=?, actual_closures=?, status='completed' WHERE id=?",
        (body.actual_delay_minutes, int(body.actual_closures), event_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    conn.close()
    return row_to_dict(row)

@app.get("/hotspots")
def get_hotspots():
    return HOTSPOTS

@app.get("/corridors")
def list_corridors():
    return CORRIDORS

@app.get("/zones")
def list_zones():
    return ZONES

@app.get("/junctions")
def list_junctions():
    return JUNCTIONS

@app.get("/police_stations")
def list_police_stations():
    return POLICE_STATIONS

@app.get("/junction_coords")
def get_junction_coords():
    return JUNCTION_COORDS

@app.get("/corridor_connections")
def get_corridor_connections():
    return CORRIDOR_CONNECTIONS


# ── Frontend static hosting for single-service deployment ───────────────────
FRONTEND_DIST = BASE_DIR.parent / "routegenie" / "dist" / "public"

if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    public_dir = FRONTEND_DIST / "public"

    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    if public_dir.exists():
        app.mount("/public", StaticFiles(directory=public_dir), name="public")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        requested = FRONTEND_DIST / full_path
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / "index.html")
