"""
平流层重力波参数化模型 - Python 参考实现
包含 f2py Fortran 封装和 NumPy 纯 Python 回退
"""

import numpy as np
from typing import Tuple


def _gravity_wave_numpy(
    nlon: int = 32,
    nlat: int = 32,
    nlev: int = 20,
    wind_shear: float = 0.008,
    buoy_freq: float = 0.02,
    coriolis: float = 1e-4,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    纯 NumPy 实现的重力波参数化模型
    算法逻辑与 Fortran 版本完全一致，用于验证和无 Fortran 环境回退
    """
    pi = np.pi
    deg2rad = pi / 180.0

    dlon = 360.0 / nlon
    dlat = 180.0 / (nlat - 1)
    dlev = 1000.0 / nlev

    N2 = buoy_freq * buoy_freq
    f2 = coriolis * coriolis

    u_field = np.zeros((nlon, nlat, nlev), dtype=np.float64)
    v_field = np.zeros((nlon, nlat, nlev), dtype=np.float64)
    w_field = np.zeros((nlon, nlat, nlev), dtype=np.float64)

    lon_grid = np.arange(nlon) * dlon
    lat_grid = -90.0 + np.arange(nlat) * dlat
    z_grid = np.arange(nlev) * dlev

    for k in range(nlev):
        z = z_grid[k]
        for j in range(nlat):
            lat = lat_grid[j]
            lat_rad = lat * deg2rad
            v_bg = wind_shear * z * np.cos(lat_rad)

            for i in range(nlon):
                lon = lon_grid[i]
                lon_rad = lon * deg2rad
                u_bg = wind_shear * z * np.sin(lon_rad)

                sum_r = 0.0
                sum_i = 0.0

                for m in range(1, 5):
                    kx = m * 2.0 * pi / 360.0
                    for n in range(1, 5):
                        ky = n * 2.0 * pi / 180.0

                        tmp = kx * kx + ky * ky
                        if tmp < 1e-10:
                            tmp = 1e-10

                        u_bg2 = u_bg * u_bg
                        numer = (N2 - f2) * tmp
                        denom = u_bg2 * tmp + f2
                        kz = np.sqrt(max(numer / denom, 0.0))

                        omega = np.sqrt(
                            N2 * (kx * kx + ky * ky) /
                            (kx * kx + ky * ky + kz * kz) + f2
                        )

                        ampl = 1.0 / (m * n)
                        ampl *= np.exp(-0.5 * z / 5000.0)

                        phase = kx * lon + ky * lat + kz * z

                        int_r, int_i = _trapz_int(
                            m, n, kx, ky, kz, omega, z, N2, f2
                        )

                        sum_r += ampl * (np.cos(phase) + int_r)
                        sum_i += ampl * (np.sin(phase) + int_i)

                u_field[i, j, k] = u_bg + 2.0 * sum_r
                v_field[i, j, k] = v_bg - 2.0 * sum_i

                kx_eff = 2.0 * pi / 360.0
                ky_eff = 2.0 * pi / 180.0

                rr = kx_eff * sum_i - ky_eff * sum_r
                ri = -kx_eff * sum_r - ky_eff * sum_i

                omega_eff = max(buoy_freq * 0.5, 0.01)
                w_field[i, j, k] = (N2 / omega_eff) * np.sqrt(rr * rr + ri * ri) \
                    / max(buoy_freq, 0.01)

    u_field = _recursive_smooth(u_field, 2)
    v_field = _recursive_smooth(v_field, 2)
    w_field = _recursive_smooth(w_field, 2)

    return u_field, v_field, w_field


def _trapz_int(
    m: int, n: int, kx: float, ky: float, kz: float,
    omega: float, z: float, N2: float, f2: float
) -> Tuple[float, float]:
    """复梯形积分"""
    ns = 20
    ds = 500.0 / ns
    acc_r = 0.0
    acc_i = 0.0

    tmp = kx * kx + ky * ky + kz * kz
    if tmp < 1e-10:
        tmp = 1e-10

    for s in range(1, ns + 1):
        zs = z - (ns - s) * ds
        mag = (N2 / omega) / np.sqrt(tmp)
        mag *= np.exp(-0.5 * abs(z - zs) / 2000.0)
        phase_s = kx * 0.1 * m + ky * 0.1 * n + kz * zs
        r1 = mag * np.cos(phase_s)
        i1 = mag * np.sin(phase_s)

        zs = z - (ns - s + 1) * ds
        mag = (N2 / omega) / np.sqrt(tmp)
        mag *= np.exp(-0.5 * abs(z - zs) / 2000.0)
        phase_s = kx * 0.1 * m + ky * 0.1 * n + kz * zs
        r2 = mag * np.cos(phase_s)
        i2 = mag * np.sin(phase_s)

        acc_r += (r1 + r2) * ds * 0.5
        acc_i += (i1 + i2) * ds * 0.5

    return acc_r * 1e-4, acc_i * 1e-4


def _recursive_smooth(field: np.ndarray, n_iter: int) -> np.ndarray:
    """3D 递推平滑"""
    nx, ny, nz = field.shape
    tmp = np.zeros_like(field)

    for _ in range(n_iter):
        for k in range(nz):
            for j in range(ny):
                for i in range(nx):
                    val = field[i, j, k]
                    count = 1.0

                    if i > 0:
                        val += field[i - 1, j, k]
                        count += 1
                    if i < nx - 1:
                        val += field[i + 1, j, k]
                        count += 1
                    if j > 0:
                        val += field[i, j - 1, k]
                        count += 1
                    if j < ny - 1:
                        val += field[i, j + 1, k]
                        count += 1
                    if k > 0:
                        val += field[i, j, k - 1]
                        count += 1
                    if k < nz - 1:
                        val += field[i, j, k + 1]
                        count += 1

                    tmp[i, j, k] = val / count

        field = tmp.copy()

    return field


def gravity_wave_param(
    nlon: int = 32,
    nlat: int = 32,
    nlev: int = 20,
    wind_shear: float = 0.008,
    buoy_freq: float = 0.02,
    coriolis: float = 1e-4,
    use_fortran: bool = False,
) -> dict:
    """
    统一的模型调用入口

    Args:
        nlon, nlat, nlev: 网格尺寸
        wind_shear: 风切变 s^-1
        buoy_freq: 浮力频率 s^-1
        coriolis: 柯氏参数 s^-1
        use_fortran: 是否使用 f2py 封装的 Fortran 版本

    Returns:
        dict: 包含 u, v, w 三个风场分量及计算元数据
    """
    if use_fortran:
        try:
            from gravity_wave_fortran import gravity_wave_param as f_gw
            u = np.zeros((nlon, nlat, nlev), order='F')
            v = np.zeros((nlon, nlat, nlev), order='F')
            w = np.zeros((nlon, nlat, nlev), order='F')
            f_gw(nlon, nlat, nlev, wind_shear, buoy_freq, coriolis, u, v, w)
            source = 'fortran'
        except ImportError:
            u, v, w = _gravity_wave_numpy(nlon, nlat, nlev, wind_shear, buoy_freq, coriolis)
            source = 'numpy_fallback'
    else:
        u, v, w = _gravity_wave_numpy(nlon, nlat, nlev, wind_shear, buoy_freq, coriolis)
        source = 'numpy'

    return {
        'u': u,
        'v': v,
        'w': w,
        'dims': {'nlon': nlon, 'nlat': nlat, 'nlev': nlev},
        'source': source,
    }
