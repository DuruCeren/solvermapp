program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, stage
  real(dp) :: h                      ! [Input] (W/(m^2 K)) Heat transfer coefficient
  real(dp) :: A                      ! [Input] (m^2) Area
  real(dp) :: T                      ! [State] (K) Temperature
  real(dp) :: T_inf                  ! [Input] (K) Ambient
  real(dp) :: Q_dot                  ! [Intermediate] (W) Heat flux
  real(dp) :: m                      ! [Input] (kg) Mass
  real(dp) :: c_p                    ! [Input] (J/(kg K)) Heat capacity
  real(dp) :: time                   ! [Input] (s) Time
  real(dp) :: F_0                    ! [Input] (m/s^2) Forcing amplitude
  real(dp) :: omega                  ! [Input] (1/s) Angular frequency
  real(dp) :: F                      ! [Intermediate] (m/s^2) Forcing
  real(dp) :: v                      ! [State] (m/s) Velocity
  real(dp) :: x                      ! [State] (m) Position
  real(dp) :: E_k                    ! [Output] (m^2/s^2) Energy
  real(dp) :: h_rk, time_rk0, T_rate, T_rk0, T_acc, x_rate, x_rk0, x_acc, v_rate, v_rk0, v_acc
  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]

  ! --- Stage 0: inputs and start values of state variables ---
  h = 10.0_dp
  A = 0.01_dp
  T = 373.0_dp
  T_inf = 293.0_dp
  m = 0.1_dp
  c_p = 900.0_dp
  F_0 = 0.5_dp
  omega = 2.0_dp
  v = 0.0_dp
  x = 1.0_dp

  ! --- Stage 1 ---
  ! --- ODE system: T over time: RK4, 60 steps ---
  ! Cooling: \frac{dT}{dt} = -\frac{\dot{Q}}{m c_p}
  time = 0.0_dp
  h_rk = (600.0_dp - time) / real(60, dp)
  do step = 1, 60
    time_rk0 = time
    T_rk0 = T
    T_acc = 0.0_dp * T
    do stage = 1, 4
      ! [EXPLICIT] Heat flux: \dot{Q} = h A (T - T_\infty)
      Q_dot = h * A * (T - T_inf)
      T_rate = -((Q_dot) / (m * c_p))
      T_acc = T_acc + w_rk(stage) * T_rate
      if (stage < 4) then
        time = time_rk0 + c_rk(stage) * h_rk
        T = T_rk0 + c_rk(stage) * h_rk * T_rate
      end if
    end do
    time = time_rk0 + h_rk
    T = T_rk0 + h_rk / 6.0_dp * T_acc
  end do
  ! Algebraic equations at the final time
  ! [EXPLICIT] Heat flux: \dot{Q} = h A (T - T_\infty)
  Q_dot = h * A * (T - T_inf)

  ! --- Stage 2 ---
  ! --- ODE system: x, v over time: RK4, 300 steps ---
  ! Position: \frac{dx}{dt} = v
  ! Velocity: \frac{dv}{dt} = -\omega^2 x + F
  time = 0.0_dp
  h_rk = (3.0_dp - time) / real(300, dp)
  do step = 1, 300
    time_rk0 = time
    x_rk0 = x
    x_acc = 0.0_dp * x
    v_rk0 = v
    v_acc = 0.0_dp * v
    do stage = 1, 4
      ! [EXPLICIT] Forcing: F = F_0 \sin(\omega t)
      F = F_0 * sin(omega * time)
      x_rate = v
      v_rate = - omega**2 * x + F
      x_acc = x_acc + w_rk(stage) * x_rate
      v_acc = v_acc + w_rk(stage) * v_rate
      if (stage < 4) then
        time = time_rk0 + c_rk(stage) * h_rk
        x = x_rk0 + c_rk(stage) * h_rk * x_rate
        v = v_rk0 + c_rk(stage) * h_rk * v_rate
      end if
    end do
    time = time_rk0 + h_rk
    x = x_rk0 + h_rk / 6.0_dp * x_acc
    v = v_rk0 + h_rk / 6.0_dp * v_acc
  end do
  ! Algebraic equations at the final time
  ! [EXPLICIT] Forcing: F = F_0 \sin(\omega t)
  F = F_0 * sin(omega * time)

  ! --- Stage 3 ---
  ! [EXPLICIT] Energy: E_k = \frac{1}{2} v^2 + \frac{1}{2} \omega^2 x^2
  E_k = ((1.0_dp) / (2.0_dp)) * v**2 + ((1.0_dp) / (2.0_dp)) * omega**2 * x**2

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "h", h
  print '(a12, " = ", *(g0, 1x))', "A", A
  print '(a12, " = ", *(g0, 1x))', "T", T
  print '(a12, " = ", *(g0, 1x))', "T_inf", T_inf
  print '(a12, " = ", *(g0, 1x))', "Q_dot", Q_dot
  print '(a12, " = ", *(g0, 1x))', "m", m
  print '(a12, " = ", *(g0, 1x))', "c_p", c_p
  print '(a12, " = ", *(g0, 1x))', "time", time
  print '(a12, " = ", *(g0, 1x))', "F_0", F_0
  print '(a12, " = ", *(g0, 1x))', "omega", omega
  print '(a12, " = ", *(g0, 1x))', "F", F
  print '(a12, " = ", *(g0, 1x))', "v", v
  print '(a12, " = ", *(g0, 1x))', "x", x
  print '(a12, " = ", *(g0, 1x))', "E_k", E_k
end program solvermapp