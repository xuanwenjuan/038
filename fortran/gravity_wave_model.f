      subroutine gravity_wave_param(nlon, nlat, nlev,
     &                              wind_shear, buoy_freq, coriolis,
     &                              u_field, v_field, w_field)
      implicit none

      integer, intent(in) :: nlon, nlat, nlev
      real*8, intent(in)  :: wind_shear, buoy_freq, coriolis
      real*8, intent(out) :: u_field(nlon, nlat, nlev)
      real*8, intent(out) :: v_field(nlon, nlat, nlev)
      real*8, intent(out) :: w_field(nlon, nlat, nlev)

      integer :: i, j, k, m, n
      real*8  :: dlon, dlat, dlev, pi, deg2rad
      real*8  :: lon, lat, z, kx, ky, kz, omega
      real*8  :: ampl, phase, u_bg, v_bg, N2, f2
      real*8  :: cr, ci, rr, ri, tmp
      complex*16 :: z_exp, z_int, z_amp, z_phase
      complex*16 :: z_a, z_b, z_sum

      pi = 3.14159265358979323846d0
      deg2rad = pi / 180.0d0

      dlon = 360.0d0 / dble(nlon)
      dlat = 180.0d0 / dble(nlat - 1)
      dlev = 1000.0d0 / dble(nlev)

      N2 = buoy_freq * buoy_freq
      f2 = coriolis * coriolis

      do k = 1, nlev
         z = dble(k - 1) * dlev

         do j = 1, nlat
            lat = -90.0d0 + dble(j - 1) * dlat
            v_bg = wind_shear * z * cos(lat * deg2rad)

            do i = 1, nlon
               lon = dble(i - 1) * dlon
               u_bg = wind_shear * z * sin(lon * deg2rad)

               z_sum = (0.0d0, 0.0d0)
               do m = 1, 4
                  kx = dble(m) * 2.0d0 * pi / (360.0d0)
                  do n = 1, 4
                     ky = dble(n) * 2.0d0 * pi / (180.0d0)

                     tmp = kx * kx + ky * ky
                     if (tmp .lt. 1.0d-10) tmp = 1.0d-10

                     kz = sqrt(max((N2 - f2) * tmp /
     &                    (u_bg * u_bg * tmp + f2), 0.0d0))

                     omega = sqrt(N2 * (kx * kx + ky * ky) /
     &                             (kx * kx + ky * ky + kz * kz) + f2)

                     ampl = 1.0d0 / dble(m * n)
                     ampl = ampl * exp(-0.5d0 * z / 5000.0d0)

                     phase = kx * lon + ky * lat + kz * z
     &                       - omega * 0.0d0

                     z_phase = dcmplx(0.0d0, phase)
                     call complex_exp_safe(z_phase, z_exp)

                     call complex_trapz_int(m, n, kx, ky, kz,
     &                                      omega, z, N2, f2,
     &                                      z_int)

                     z_a = dcmplx(ampl, 0.0d0)
                     z_b = z_exp + z_int
                     z_amp = z_a * z_b

                     z_sum = z_sum + z_amp
                  end do
               end do

               u_field(i, j, k) = u_bg + 2.0d0 * dble(z_sum)
               v_field(i, j, k) = v_bg - 2.0d0 * dimag(z_sum)

               cr = dble(z_sum)
               ci = dimag(z_sum)
               rr = kx * ci - ky * cr
               ri = -kx * cr - ky * ci
               w_field(i, j, k) = (N2 / omega) *
     &                             sqrt(rr * rr + ri * ri) *
     &                             (1.0d0 / max(buoy_freq, 0.01d0))

            end do
         end do
      end do

      call recursive_smooth(u_field, nlon, nlat, nlev, 2)
      call recursive_smooth(v_field, nlon, nlat, nlev, 2)
      call recursive_smooth(w_field, nlon, nlat, nlev, 2)

      return
      end

      subroutine complex_exp_safe(z_in, z_out)
      implicit none
      complex*16, intent(in)  :: z_in
      complex*16, intent(out) :: z_out
      real*8 :: r_in, i_in, r_exp, max_exp

      max_exp = 50.0d0
      r_in = dble(z_in)
      i_in = dimag(z_in)

      r_exp = min(max(r_in, -max_exp), max_exp)
      z_out = dcmplx(exp(r_exp) * cos(i_in),
     &               exp(r_exp) * sin(i_in))
      return
      end

      subroutine complex_trapz_int(m, n, kx, ky, kz, omega, z,
     &                             N2, f2, z_result)
      implicit none
      integer, intent(in) :: m, n
      real*8, intent(in)  :: kx, ky, kz, omega, z, N2, f2
      complex*16, intent(out) :: z_result

      integer :: ns, s
      real*8  :: ds, zs, phase_s, tmp, mag
      complex*16 :: z1, z2, z_acc

      ns = 20
      ds = 500.0d0 / dble(ns)
      z_acc = (0.0d0, 0.0d0)

      do s = 1, ns
         zs = z - dble(ns - s) * ds

         tmp = kx * kx + ky * ky + kz * kz
         if (tmp .lt. 1.0d-10) tmp = 1.0d-10
         mag = (N2 / omega) / sqrt(tmp)
         mag = mag * exp(-0.5d0 * abs(z - zs) / 2000.0d0)

         phase_s = kx * 0.1d0 * dble(m) + ky * 0.1d0 * dble(n)
     &           + kz * zs

         z1 = dcmplx(mag * cos(phase_s), mag * sin(phase_s))

         zs = z - dble(ns - s + 1) * ds
         phase_s = kx * 0.1d0 * dble(m) + ky * 0.1d0 * dble(n)
     &           + kz * zs
         mag = (N2 / omega) / sqrt(tmp)
         mag = mag * exp(-0.5d0 * abs(z - zs) / 2000.0d0)
         z2 = dcmplx(mag * cos(phase_s), mag * sin(phase_s))

         z_acc = z_acc + (z1 + z2) * dcmplx(ds * 0.5d0, 0.0d0)
      end do

      z_result = z_acc * dcmplx(1.0d-4, 0.0d0)
      return
      end

      subroutine recursive_smooth(field, nx, ny, nz, n_iter)
      implicit none
      integer, intent(in) :: nx, ny, nz, n_iter
      real*8, intent(inout) :: field(nx, ny, nz)
      real*8, allocatable :: tmp(:,:,:)
      integer :: iter, i, j, k
      real*8  :: val

      allocate(tmp(nx, ny, nz))

      do iter = 1, n_iter
         do k = 1, nz
            do j = 1, ny
               do i = 1, nx
                  val = field(i, j, k)
                  if (i .gt. 1) val = val + field(i-1, j, k)
                  if (i .lt. nx) val = val + field(i+1, j, k)
                  if (j .gt. 1) val = val + field(i, j-1, k)
                  if (j .lt. ny) val = val + field(i, j+1, k)
                  if (k .gt. 1) val = val + field(i, j, k-1)
                  if (k .lt. nz) val = val + field(i, j, k+1)
                  tmp(i, j, k) = val / 7.0d0
               end do
            end do
         end do
         do k = 1, nz
            do j = 1, ny
               do i = 1, nx
                  field(i, j, k) = tmp(i, j, k)
               end do
            end do
         end do
      end do

      deallocate(tmp)
      return
      end
