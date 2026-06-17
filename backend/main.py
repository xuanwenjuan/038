"""
FastAPI 后端服务 - 基准验证 API + 协同调优室
提供 WebSocket 协同、书签标注持久化、剖面提取等功能
"""

import time
import io
import struct
import uuid
import json
import threading
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
import numpy as np

try:
    import motor.motor_asyncio
    HAS_MONGO = True
except ImportError:
    HAS_MONGO = False

try:
    import socketio
    HAS_SOCKETIO = True
except ImportError:
    HAS_SOCKETIO = False

from gravity_wave_model import gravity_wave_param


fortran_lock = threading.Lock()


def safe_gravity_wave_param(**kwargs):
    with fortran_lock:
        return gravity_wave_param(**kwargs)


app = FastAPI(
    title="平流层重力波可视化 API",
    description="基准验证 + 协同参数调优室 + 书签标注系统",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URI = "mongodb://localhost:27017"
MONGO_DB = "gravity_wave_lab"

if HAS_MONGO:
    try:
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        db = mongo_client[MONGO_DB]
        annotations_collection = db["annotations"]
        rooms_collection = db["rooms"]
        MONGO_READY = True
    except Exception as e:
        print(f"[WARN] MongoDB 连接失败，使用内存存储: {e}")
        MONGO_READY = False
else:
    MONGO_READY = False

memory_annotations: Dict[str, List[Dict[str, Any]]] = {}
memory_rooms: Dict[str, Dict[str, Any]] = {}

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*") if HAS_SOCKETIO else None
socket_app = socketio.ASGIApp(sio) if HAS_SOCKETIO else None

if HAS_SOCKETIO and sio:
    app.mount("/ws", socket_app)


class RoomMember:
    def __init__(self, sid: str, name: str, color: str):
        self.sid = sid
        self.name = name
        self.color = color
        self.joined_at = time.time()


rooms: Dict[str, Dict[str, RoomMember]] = {}
room_params: Dict[str, Dict[str, float]] = {}


if HAS_SOCKETIO and sio:
    @sio.event
    async def connect(sid, environ):
        print(f"[WS] Client connected: {sid}")

    @sio.event
    async def disconnect(sid):
        print(f"[WS] Client disconnected: {sid}")
        for room_id, members in rooms.items():
            if sid in members:
                del members[sid]
                await sio.emit("member_left", {"sid": sid, "roomId": room_id}, room=room_id)
                await sio.emit("room_members", list(members.values()), room=room_id)
                if not members:
                    if room_id in room_params:
                        del room_params[room_id]
                break

    @sio.event
    async def join_room(sid, data):
        room_id = data.get("roomId")
        user_name = data.get("userName", f"用户_{sid[:6]}")
        color = data.get("color", "#5ab0ff")

        if not room_id:
            return {"success": False, "error": "缺少 roomId"}

        sio.enter_room(sid, room_id)

        if room_id not in rooms:
            rooms[room_id] = {}

        rooms[room_id][sid] = RoomMember(sid, user_name, color)

        if room_id not in room_params:
            room_params[room_id] = {
                "windShear": 0.008,
                "buoyFreq": 0.02,
                "coriolis": 1e-4,
            }

        params = room_params[room_id]
        members = [m.__dict__ for m in rooms[room_id].values()]

        await sio.emit("member_joined", {"sid": sid, "member": members[-1], "roomId": room_id}, room=room_id)
        await sio.emit("room_members", members, room=room_id)

        return {
            "success": True,
            "roomId": room_id,
            "params": params,
            "members": members,
        }

    @sio.event
    async def leave_room(sid, data):
        room_id = data.get("roomId")
        if not room_id or room_id not in rooms:
            return {"success": False}

        sio.leave_room(sid, room_id)
        if sid in rooms[room_id]:
            del rooms[room_id][sid]
            await sio.emit("member_left", {"sid": sid, "roomId": room_id}, room=room_id)
            await sio.emit("room_members", list(rooms[room_id].values()), room=room_id)
        return {"success": True}

    @sio.event
    async def update_params(sid, data):
        room_id = data.get("roomId")
        params = data.get("params")

        if not room_id or not params:
            return {"success": False}

        room_params[room_id] = params

        await sio.emit("params_updated", {
            "sid": sid,
            "params": params,
            "roomId": room_id,
        }, room=room_id, skip_sid=sid)

        return {"success": True}

    @sio.event
    async def cursor_move(sid, data):
        room_id = data.get("roomId")
        if not room_id:
            return
        await sio.emit("cursor_moved", {
            "sid": sid,
            "position": data.get("position"),
            "roomId": room_id,
        }, room=room_id, skip_sid=sid)

    @sio.event
    async def add_annotation(sid, data):
        room_id = data.get("roomId")
        if not room_id:
            return
        await sio.emit("annotation_added", data, room=room_id, skip_sid=sid)

    @sio.event
    async def delete_annotation(sid, data):
        room_id = data.get("roomId")
        if not room_id:
            return
        await sio.emit("annotation_deleted", data, room=room_id, skip_sid=sid)


class ComputeRequest(BaseModel):
    nlon: int = 32
    nlat: int = 32
    nlev: int = 20
    wind_shear: float = 0.008
    buoy_freq: float = 0.02
    coriolis: float = 1e-4
    use_fortran: bool = False
    format: str = "json"


class ProfileRequest(BaseModel):
    nlon: int = 32
    nlat: int = 32
    nlev: int = 20
    wind_shear: float = 0.008
    buoy_freq: float = 0.02
    coriolis: float = 1e-4
    point1: Dict[str, float]
    point2: Dict[str, float]
    num_samples: int = 50


class Annotation(BaseModel):
    id: str
    roomId: str
    author: str
    authorColor: str
    text: str
    position: Dict[str, float]
    params: Dict[str, float]
    timestamp: float
    createdAt: Optional[str] = None


class CreateAnnotationRequest(BaseModel):
    roomId: str
    author: str
    authorColor: str
    text: str
    position: Dict[str, float]
    params: Dict[str, float]


@app.get("/")
async def root():
    return {
        "name": "平流层重力波可视化 API",
        "version": "2.0.0",
        "features": [
            "基准验证 API",
            "WebSocket 协同调优室",
            "书签标注系统 (MongoDB)",
            "垂直剖面提取",
        ],
        "websocket": "/ws" if HAS_SOCKETIO else "未启用 (安装 python-socketio)",
        "mongodb": "已连接" if MONGO_READY else "未连接 (安装 motor)",
        "endpoints": [
            "/api/compute - POST: 计算风场",
            "/api/validate - POST: 与输入数据对比验证",
            "/api/profile - POST: 提取垂直剖面",
            "/api/annotations - GET/POST/DELETE: 书签标注",
            "/api/rooms - POST/GET: 房间管理",
            "/api/share - POST/GET: 短链接分享",
            "/api/health - GET: 健康检查",
        ],
    }


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": time.time(),
        "mongodb": MONGO_READY,
        "socketio": HAS_SOCKETIO,
    }


@app.post("/api/compute")
async def compute(req: ComputeRequest):
    t0 = time.time()
    result = safe_gravity_wave_param(
        nlon=req.nlon,
        nlat=req.nlat,
        nlev=req.nlev,
        wind_shear=req.wind_shear,
        buoy_freq=req.buoy_freq,
        coriolis=req.coriolis,
        use_fortran=req.use_fortran,
    )
    t1 = time.time()

    u = result['u']
    v = result['v']
    w = result['w']

    if req.format == "binary":
        data = b""
        data += struct.pack('=iii', req.nlon, req.nlat, req.nlev)
        data += u.astype(np.float64).tobytes()
        data += v.astype(np.float64).tobytes()
        data += w.astype(np.float64).tobytes()
        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={
                "X-Compute-Time": str(t1 - t0),
                "X-Source": result['source'],
            },
        )

    return {
        "compute_time_ms": (t1 - t0) * 1000,
        "source": result['source'],
        "dims": result['dims'],
        "u_stats": {
            "min": float(u.min()),
            "max": float(u.max()),
            "mean": float(u.mean()),
        },
        "v_stats": {
            "min": float(v.min()),
            "max": float(v.max()),
            "mean": float(v.mean()),
        },
        "w_stats": {
            "min": float(w.min()),
            "max": float(w.max()),
            "mean": float(w.mean()),
        },
        "u": u.flatten().tolist(),
        "v": v.flatten().tolist(),
        "w": w.flatten().tolist(),
    }


@app.post("/api/validate")
async def validate(request: dict):
    try:
        import base64
        wasm_data_b64 = request.get('wasm_data')
        if not wasm_data_b64:
            raise HTTPException(status_code=400, detail="缺少 wasm_data")

        wasm_bytes = base64.b64decode(wasm_data_b64)

        params = request.get('params', {})
        nlon = params.get('nlon', 32)
        nlat = params.get('nlat', 32)
        nlev = params.get('nlev', 20)
        grid_size = nlon * nlat * nlev
        field_bytes = grid_size * 8

        expected_size = field_bytes * 3
        if len(wasm_bytes) != expected_size:
            raise HTTPException(
                status_code=400,
                detail=f"数据大小不匹配: 期望 {expected_size} 字节, 实际 {len(wasm_bytes)} 字节"
            )

        u_wasm = np.frombuffer(wasm_bytes[:field_bytes], dtype=np.float64).reshape(nlon, nlat, nlev)
        v_wasm = np.frombuffer(wasm_bytes[field_bytes:field_bytes*2], dtype=np.float64).reshape(nlon, nlat, nlev)
        w_wasm = np.frombuffer(wasm_bytes[field_bytes*2:], dtype=np.float64).reshape(nlon, nlat, nlev)

        t0 = time.time()
        ref = safe_gravity_wave_param(
            nlon=nlon, nlat=nlat, nlev=nlev,
            wind_shear=params.get('wind_shear', 0.008),
            buoy_freq=params.get('buoy_freq', 0.02),
            coriolis=params.get('coriolis', 1e-4),
            use_fortran=request.get('use_fortran', False),
        )
        t1 = time.time()

        u_ref = ref['u']
        v_ref = ref['v']
        w_ref = ref['w']

        def calc_stats(a: np.ndarray, b: np.ndarray) -> dict:
            diff = a - b
            abs_diff = np.abs(diff)
            rel_diff = abs_diff / (np.abs(b) + 1e-10)
            return {
                "max_abs_error": float(abs_diff.max()),
                "mean_abs_error": float(abs_diff.mean()),
                "max_rel_error": float(rel_diff.max()),
                "mean_rel_error": float(rel_diff.mean()),
                "rmse": float(np.sqrt(np.mean(diff * diff))),
                "correlation": float(np.corrcoef(a.flatten(), b.flatten())[0, 1]),
            }

        return {
            "validate_time_ms": (t1 - t0) * 1000,
            "reference_source": ref['source'],
            "u_error": calc_stats(u_wasm, u_ref),
            "v_error": calc_stats(v_wasm, v_ref),
            "w_error": calc_stats(w_wasm, w_ref),
            "passed": bool(
                np.allclose(u_wasm, u_ref, rtol=1e-3, atol=1e-6) and
                np.allclose(v_wasm, v_ref, rtol=1e-3, atol=1e-6) and
                np.allclose(w_wasm, w_ref, rtol=1e-2, atol=1e-5)
            ),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/profile")
async def extract_profile(req: ProfileRequest):
    """
    提取两点之间的垂直剖面数据
    返回各高度层上 u/v/w 分量的插值结果
    """
    t0 = time.time()
    result = safe_gravity_wave_param(
        nlon=req.nlon, nlat=req.nlat, nlev=req.nlev,
        wind_shear=req.wind_shear,
        buoy_freq=req.buoy_freq,
        coriolis=req.coriolis,
        use_fortran=False,
    )
    u = result['u']
    v = result['v']
    w = result['w']

    lon_range = 360.0
    lat_range = 180.0
    z_range = 1000.0
    dlon = lon_range / req.nlon
    dlat = lat_range / (req.nlat - 1)
    dz = z_range / req.nlev

    def trilinear(field: np.ndarray, lon: float, lat: float, z: float) -> float:
        iF = lon / dlon
        jF = (lat + 90.0) / dlat
        kF = z / dz

        iF = ((iF % req.nlon) + req.nlon) % req.nlon
        jF = max(0, min(req.nlat - 1, jF))
        kF = max(0, min(req.nlev - 1, kF))

        i0 = int(np.floor(iF))
        j0 = int(np.floor(jF))
        k0 = int(np.floor(kF))
        i1 = min(i0 + 1, req.nlon - 1)
        j1 = min(j0 + 1, req.nlat - 1)
        k1 = min(k0 + 1, req.nlev - 1)

        fi = iF - i0
        fj = jF - j0
        fk = kF - k0

        x00 = field[i0, j0, k0] * (1 - fi) + field[i1, j0, k0] * fi
        x10 = field[i0, j1, k0] * (1 - fi) + field[i1, j1, k0] * fi
        x01 = field[i0, j0, k1] * (1 - fi) + field[i1, j0, k1] * fi
        x11 = field[i0, j1, k1] * (1 - fi) + field[i1, j1, k1] * fi

        y0 = x00 * (1 - fj) + x10 * fj
        y1 = x01 * (1 - fj) + x11 * fj

        return y0 * (1 - fk) + y1 * fk

    p1 = req.point1
    p2 = req.point2
    dx = p2['x'] - p1['x']
    dy = p2['y'] - p1['y']
    dz_sel = p2['z'] - p1['z']

    profile_data = []
    for k in range(req.nlev):
        z = k * dz
        layer_data = []
        for s in range(req.num_samples):
            t = s / (req.num_samples - 1)
            lon = p1['x'] + dx * t
            lat = p1['y'] + dy * t
            zi = p1['z'] + dz_sel * t if dz_sel != 0 else z

            u_val = trilinear(u, lon, lat, zi)
            v_val = trilinear(v, lon, lat, zi)
            w_val = trilinear(w, lon, lat, zi)
            speed = np.sqrt(u_val * u_val + v_val * v_val + w_val * w_val)

            layer_data.append({
                "t": t,
                "lon": lon,
                "lat": lat,
                "z": zi,
                "u": float(u_val),
                "v": float(v_val),
                "w": float(w_val),
                "speed": float(speed),
            })
        profile_data.append({
            "z": z,
            "samples": layer_data,
        })

    vertical_profile = []
    for k in range(req.nlev):
        z = k * dz
        mid_t = 0.5
        lon = p1['x'] + dx * mid_t
        lat = p1['y'] + dy * mid_t
        u_val = trilinear(u, lon, lat, z)
        v_val = trilinear(v, lon, lat, z)
        w_val = trilinear(w, lon, lat, z)
        speed = np.sqrt(u_val * u_val + v_val * v_val + w_val * w_val)
        vertical_profile.append({
            "z": z,
            "u": float(u_val),
            "v": float(v_val),
            "w": float(w_val),
            "speed": float(speed),
        })

    t1 = time.time()
    return {
        "compute_time_ms": (t1 - t0) * 1000,
        "point1": req.point1,
        "point2": req.point2,
        "num_samples": req.num_samples,
        "nlev": req.nlev,
        "profile": profile_data,
        "vertical": vertical_profile,
    }


@app.get("/api/annotations/{room_id}")
async def get_annotations(room_id: str):
    if MONGO_READY:
        cursor = annotations_collection.find({"roomId": room_id}).sort("timestamp", -1)
        results = await cursor.to_list(length=100)
        for r in results:
            r["_id"] = str(r["_id"])
        return {"annotations": results}
    else:
        return {"annotations": memory_annotations.get(room_id, []), "source": "memory"}


@app.post("/api/annotations")
async def create_annotation(req: CreateAnnotationRequest):
    now = time.time()
    annotation = {
        "id": str(uuid.uuid4()),
        "roomId": req.roomId,
        "author": req.author,
        "authorColor": req.authorColor,
        "text": req.text,
        "position": req.position,
        "params": req.params,
        "timestamp": now,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }

    if MONGO_READY:
        await annotations_collection.insert_one(annotation)
    else:
        if req.roomId not in memory_annotations:
            memory_annotations[req.roomId] = []
        memory_annotations[req.roomId].insert(0, annotation)

    return annotation


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str):
    if MONGO_READY:
        result = await annotations_collection.delete_one({"id": annotation_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="标注不存在")
    else:
        deleted = False
        for room_id, anns in memory_annotations.items():
            for i, a in enumerate(anns):
                if a["id"] == annotation_id:
                    del anns[i]
                    deleted = True
                    break
            if deleted:
                break
        if not deleted:
            raise HTTPException(status_code=404, detail="标注不存在")

    return {"success": True, "id": annotation_id}


@app.post("/api/rooms")
async def create_room():
    room_id = str(uuid.uuid4())[:8].lower()
    room_data = {
        "roomId": room_id,
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "params": {
            "windShear": 0.008,
            "buoyFreq": 0.02,
            "coriolis": 1e-4,
        },
    }

    if MONGO_READY:
        await rooms_collection.insert_one(room_data)
    else:
        memory_rooms[room_id] = room_data

    return room_data


@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    if MONGO_READY:
        room = await rooms_collection.find_one({"roomId": room_id})
        if not room:
            raise HTTPException(status_code=404, detail="房间不存在")
        room["_id"] = str(room["_id"])
        return room
    else:
        if room_id not in memory_rooms:
            raise HTTPException(status_code=404, detail="房间不存在")
        return memory_rooms[room_id]


short_links: Dict[str, Dict[str, Any]] = {}


@app.post("/api/share")
async def create_share_link(data: dict):
    short_id = str(uuid.uuid4())[:6].lower()
    share_data = {
        "shortId": short_id,
        "params": data.get("params"),
        "viewpoint": data.get("viewpoint"),
        "annotationId": data.get("annotationId"),
        "roomId": data.get("roomId"),
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "expiresAt": time.time() + 7 * 24 * 3600,
    }

    if MONGO_READY:
        await db["short_links"].insert_one(share_data)
    else:
        short_links[short_id] = share_data

    return {
        "shortId": short_id,
        "url": f"http://localhost:5173/share/{short_id}",
    }


@app.get("/api/share/{short_id}")
async def get_share_link(short_id: str):
    if MONGO_READY:
        data = await db["short_links"].find_one({"shortId": short_id})
        if not data:
            raise HTTPException(status_code=404, detail="短链接不存在或已过期")
        if data.get("expiresAt", 0) < time.time():
            raise HTTPException(status_code=410, detail="短链接已过期")
        data["_id"] = str(data["_id"])
        return data
    else:
        if short_id not in short_links:
            raise HTTPException(status_code=404, detail="短链接不存在")
        if short_links[short_id]["expiresAt"] < time.time():
            raise HTTPException(status_code=410, detail="短链接已过期")
        return short_links[short_id]


@app.get("/s/{short_id}")
async def redirect_short_link(short_id: str):
    return RedirectResponse(url=f"http://localhost:5173/share/{short_id}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
