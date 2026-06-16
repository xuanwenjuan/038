"""
f2py 编译脚本 - 将 Fortran 77 模型编译为 Python 扩展模块

使用方法:
    python setup_f2py.py build_ext --inplace

需要 gfortran 和 numpy.f2py
"""

from numpy.distutils.core import setup
from numpy.distutils.extension import Extension
import os
import sys

fortran_dir = os.path.join(os.path.dirname(__file__), '..', 'fortran')
src_file = os.path.join(fortran_dir, 'gravity_wave_model.f')

ext = Extension(
    name='gravity_wave_fortran',
    sources=[src_file],
    extra_f77_compile_args=['-O2', '-fdefault-real-8', '-fdefault-double-8'],
)

if __name__ == '__main__':
    setup(
        name='gravity_wave_fortran',
        description='Fortran 77 重力波参数化模型 - f2py 封装',
        ext_modules=[ext],
    )
