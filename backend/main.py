"""
FastAPI 后端服务 - 基准验证 API
提供原始 Fortran 模型的基准计算，用于验证 WASM 版本的正确性
"""

import time
import io
import struct
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import numpy as np

from gravity_wave_model import gravity_wave_param

app = FastAPI(
    title="平流层重力波基准验证 API",
    description="基于 Fortran/f2py 的原始模型，作为 WASM 前端的基准验证",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ComputeRequest(BaseModel):
    nlon: int = 32
    nlat: int = 32
    nlev: int = 20
    wind_shear: float = 0.008
    buoy_freq: float = 0.02
    coriolis: float = 1e-4
    use_fortran: bool = False
    format: str = "json"


@app.get("/")
async def root():
    return {
        "name": "平流层重力波基准验证 API",
        "version": "1.0.0",
        "endpoints": [
            "/api/compute - POST: 计算风场",
            "/api/validate - POST: 与输入数据对比验证",
            "/api/health - GET: 健康检查",
        ],
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.post("/api/compute")
async def compute(req: ComputeRequest):
    t0 = time.time()
    result = gravity_wave_param(
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
    """
    验证接口：接收前端 WASM 计算的二进制数据，
    与后端 Fortran/NumPy 计算结果对比，返回误差统计
    """
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
        ref = gravity_wave_param(
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
