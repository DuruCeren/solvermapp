program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, it, q, i
  real(dp) :: y                      ! [State] (-) Marching state variable (y_0 = 1)
  real(dp) :: N                      ! [Input] (-) Number of force elements
  real(dp), allocatable :: f_i(:)    ! [Input] (N) Element force array
  real(dp) :: F_total                ! [Intermediate] (N) Accumulated total force
  real(dp) :: x_1                    ! [Input] (m) Lower integration bound
  real(dp) :: x_2                    ! [Input] (m) Upper integration bound
  real(dp) :: W                      ! [Intermediate] (J) Integrated work output
  real(dp) :: T                      ! [State] (K) Converged temperature state
  real(dp) :: p                      ! [Input] (Pa) Gas pressure
  real(dp) :: a                      ! [Input] (Pa m^6/mol^2) Van der Waals attraction constant (CO2)
  real(dp) :: b                      ! [Input] (m^3/mol) Van der Waals co-volume (CO2)
  real(dp) :: R_u                    ! [Input] (J/(mol·K)) Universal gas constant
  real(dp) :: T_g                    ! [Input] (K) Gas temperature
  real(dp) :: v                      ! [Output] (m^3/mol) Molar volume (start = ideal-gas volume, vapour branch)
  real(dp) :: v_new, T_new, x, dx, w_q, h_nr, dr_nr

  ! --- Stage 0: inputs and start values of state variables ---
  y = 1.0_dp
  N = 5.0_dp
  allocate(f_i(1:int(N)))
  f_i = 10.0_dp
  x_1 = 0.0_dp
  x_2 = 2.0_dp
  T = 300.0_dp
  p = 5e6_dp
  a = 0.3640_dp
  b = 4.267e-5_dp
  R_u = 8.314_dp
  T_g = 280.0_dp

  ! --- Stage 1 ---
  ! [MARCHING] State step recurrence: y_{n+1} = y_n + 1
  do step = 1, 10
    y = y + 1.0_dp
  end do
  ! [SUMMATION] Total force summation: F_{total} = \sum_{i=1}^{N} f_i
  F_total = 0.0_dp
  do i = 1, int(N)
    F_total = F_total + f_i(i)
  end do
  ! [IMPLICIT] Van der Waals equation of state: \left(p + \frac{a}{v^2}\right)\left(v - b\right) = R_u T_g
  ! Newton–Raphson on the residual (left side - right side) = 0, solved for v
  ! Branch: b <= v
  v = 4.66e-4_dp  ! initial guess
  v = max(v, b)  ! start on the branch
  do it = 1, 50
    h_nr = 1.0e-6_dp * max(abs(v), 1.0e-6_dp)
    dr_nr = (res_v(v + h_nr) - res_v(v - h_nr)) / (2.0_dp * h_nr)
    if (dr_nr == 0.0_dp) then
      print *, "Warning: zero derivative in the Newton iteration for v"
      exit
    end if
    v_new = v - res_v(v) / dr_nr
    if (v_new < b) v_new = 0.5_dp * (v + b)  ! stay on the branch
    if (abs(v_new - v) < 1e-10_dp * (1.0_dp + abs(v))) then
      v = v_new
      exit
    end if
    v = v_new
  end do
  if (it > 50) print *, "Warning: v did not converge in", 50, "iterations"

  ! --- Stage 2 ---
  ! [INTEGRAL] Boundary work integral: W = \int_{x_1}^{x_2} F_{total} \, dx
  ! Trapezoidal rule over x from x_1 to x_2
  dx = (x_2 - x_1) / real(100, dp)
  W = 0.0_dp
  do q = 0, 100
    x = x_1 + q * dx
    w_q = merge(0.5_dp, 1.0_dp, q == 0 .or. q == 100)
    W = W + w_q * (F_total) * dx
  end do

  ! --- Stage 3 ---
  ! [CONVERGENCE] Non-linear relaxation update: T_{new} = 0.5 T_{old} + 0.02 W
  do it = 1, 500
    T_new = 0.5_dp * T + 0.02_dp * W
    if (abs(T_new - T) < 1e-6_dp) then
      T = T_new
      exit
    end if
    T = T_new
  end do
  if (it > 500) print *, "Warning: T did not converge in", 500, "iterations"

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "y", y
  print '(a12, " = ", *(g0, 1x))', "N", N
  print '(a12, " = ", *(g0, 1x))', "f_i", f_i
  print '(a12, " = ", *(g0, 1x))', "F_total", F_total
  print '(a12, " = ", *(g0, 1x))', "x_1", x_1
  print '(a12, " = ", *(g0, 1x))', "x_2", x_2
  print '(a12, " = ", *(g0, 1x))', "W", W
  print '(a12, " = ", *(g0, 1x))', "T", T
  print '(a12, " = ", *(g0, 1x))', "p", p
  print '(a12, " = ", *(g0, 1x))', "a", a
  print '(a12, " = ", *(g0, 1x))', "b", b
  print '(a12, " = ", *(g0, 1x))', "R_u", R_u
  print '(a12, " = ", *(g0, 1x))', "T_g", T_g
  print '(a12, " = ", *(g0, 1x))', "v", v

contains

  ! Residual of Van der Waals equation of state: left side - right side
  real(dp) function res_v(v)
    real(dp), intent(in) :: v
    res_v = (p + ((a) / (v**2))) * (v - b) - (R_u * T_g)
  end function res_v
end program solvermapp