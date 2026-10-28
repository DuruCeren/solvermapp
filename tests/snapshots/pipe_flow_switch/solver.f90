program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: it
  real(dp) :: mu_0                   ! [Input] (Pa s) Viscosity at T_0
  real(dp) :: B                      ! [Input] (K) Viscosity constant
  real(dp) :: T_0                    ! [Input] (K) Reference temperature
  real(dp) :: rho                    ! [Input] (kg/m^3) Density
  real(dp) :: u                      ! [Input] (m/s) Velocity
  real(dp) :: D                      ! [Input] (m) Diameter
  real(dp) :: T                      ! [Input] (K) Temperature
  real(dp) :: R_e                    ! [Intermediate] (1) Reynolds
  real(dp) :: f                      ! [Intermediate] (1) Friction factor
  real(dp) :: k_s                    ! [Input] (m) Roughness
  real(dp) :: L                      ! [Input] (m) Length
  real(dp) :: Delta_p                ! [Output] (Pa) Pressure drop
  real(dp) :: f_new, h_nr, dr_nr

  ! --- Stage 0: inputs and start values of state variables ---
  mu_0 = 1e-3_dp
  B = 1800.0_dp
  T_0 = 293.0_dp
  rho = 998.0_dp
  u = 2.0_dp
  D = 0.05_dp
  T = 313.0_dp
  k_s = 4.5e-5_dp
  L = 10.0_dp

  ! --- Stage 1 ---
  ! [FUNCTION] Viscosity: \mu(T) = \mu_0 \exp\left(\frac{B}{T} - \frac{B}{T_0}\right)
  ! mu(T) is an internal function (after "contains")

  ! --- Stage 2 ---
  ! [EXPLICIT] Reynolds number: R_e = \frac{\rho u D}{\mu(T)}
  R_e = ((rho * u * D) / (mu(T)))

  ! --- Stage 3 ---
  ! --- Switch: f by case ---
  if (R_e < 2300.0_dp) then
    ! [EXPLICIT] Laminar friction: f = \frac{64}{R_e}
    f = ((64.0_dp) / (R_e))
  else
    ! [IMPLICIT] Colebrook: \frac{1}{\sqrt{f}} = -2 \log_{10}\left(\frac{k_s}{3.7 D} + \frac{2.51}{R_e \sqrt{f}}\right)
    ! Newton–Raphson on the residual (left side - right side) = 0, solved for f
    ! Branch: 1e-4 <= f
    f = 0.02_dp  ! initial guess
    f = max(f, 1e-4_dp)  ! start on the branch
    do it = 1, 50
      h_nr = 1.0e-6_dp * max(abs(f), 1.0e-6_dp)
      dr_nr = (res_f(f + h_nr) - res_f(f - h_nr)) / (2.0_dp * h_nr)
      if (dr_nr == 0.0_dp) then
        print *, "Warning: zero derivative in the Newton iteration for f"
        exit
      end if
      f_new = f - res_f(f) / dr_nr
      if (f_new < 1e-4_dp) f_new = 0.5_dp * (f + 1e-4_dp)  ! stay on the branch
      if (abs(f_new - f) < 1e-12_dp * (1.0_dp + abs(f))) then
        f = f_new
        exit
      end if
      f = f_new
    end do
    if (it > 50) print *, "Warning: f did not converge in", 50, "iterations"
  end if

  ! --- Stage 4 ---
  ! [EXPLICIT] Pressure drop: \Delta p = f \frac{L}{D} \frac{\rho u^2}{2}
  Delta_p = f * ((L) / (D)) * ((rho * u**2) / (2.0_dp))

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "mu_0", mu_0
  print '(a12, " = ", *(g0, 1x))', "B", B
  print '(a12, " = ", *(g0, 1x))', "T_0", T_0
  print '(a12, " = ", *(g0, 1x))', "rho", rho
  print '(a12, " = ", *(g0, 1x))', "u", u
  print '(a12, " = ", *(g0, 1x))', "D", D
  print '(a12, " = ", *(g0, 1x))', "T", T
  print '(a12, " = ", *(g0, 1x))', "R_e", R_e
  print '(a12, " = ", *(g0, 1x))', "f", f
  print '(a12, " = ", *(g0, 1x))', "k_s", k_s
  print '(a12, " = ", *(g0, 1x))', "L", L
  print '(a12, " = ", *(g0, 1x))', "Delta_p", Delta_p

contains

  ! Residual of Colebrook: left side - right side
  real(dp) function res_f(f)
    real(dp), intent(in) :: f
    res_f = ((1.0_dp) / (sqrt(f))) - (-2.0_dp * log10(((k_s) / (3.7_dp * D)) + ((2.51_dp) / (R_e * sqrt(f)))))
  end function res_f

  ! Viscosity: \mu(T) = \mu_0 \exp\left(\frac{B}{T} - \frac{B}{T_0}\right)
  real(dp) function mu(T)
    real(dp), intent(in) :: T
    mu = mu_0 * exp(((B) / (T)) - ((B) / (T_0)))
  end function mu
end program solvermapp