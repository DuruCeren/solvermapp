program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, stage, u_ode1, k_csv, i, j
  real(dp), allocatable :: v(:, :)   ! [State] (m/s) Velocities, one row per body
  real(dp) :: t                      ! [Input] (s) Time
  real(dp), allocatable :: r(:, :)   ! [State] (m) Positions, one row per body
  real(dp) :: G                      ! [Input] (m^3/(kg s^2)) Gravitational constant (normalised)
  real(dp), allocatable :: m(:)      ! [Input] (kg) Masses
  real(dp) :: E                      ! [Output] (J) Total energy
  real(dp) :: N                      ! [Input] (1) Number of bodies
  real(dp) :: h_rk, t_rk0, s_sum2, s_sum4, s_sum3
  real(dp), allocatable :: r_rate(:, :)
  real(dp), allocatable :: r_rk0(:, :)
  real(dp), allocatable :: r_acc(:, :)
  real(dp), allocatable :: v_rate(:, :)
  real(dp), allocatable :: v_rk0(:, :)
  real(dp), allocatable :: v_acc(:, :)
  real(dp), allocatable :: s_sum1(:)
  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]

  ! --- Stage 0: inputs and start values of state variables ---
  G = 1.0_dp
  N = 3.0_dp
  v = reshape([0.466203685_dp, 0.43236573_dp, 0.466203685_dp, 0.43236573_dp, -0.93240737_dp, -0.86473146_dp], [3, &
      & 2], order=[2, 1])
  r = reshape([0.97000436_dp, -0.24308753_dp, -0.97000436_dp, 0.24308753_dp, 0.0_dp, 0.0_dp], [3, 2], order=[2, 1])
  if (.not. allocated(m)) allocate(m(int(N)))
  m = 1.0_dp

  ! --- Stage 1 ---
  ! --- ODE system: r, v over t: RK4, 2000 steps ---
  ! Positions: \frac{d\mathbf{r}_i}{dt} = \mathbf{v}_i
  ! Velocities: \frac{d\mathbf{v}_i}{dt} = \sum_{j \ne i} G m_j \frac{\mathbf{r}_j - \mathbf{r}_i}{\|\mathbf{r}_j - \mathbf{r}_...
  t = 0.0_dp
  h_rk = (6.32591398_dp - t) / real(2000, dp)
  ! Solution every 10 steps -> ode_system_1.csv
  open(newunit=u_ode1, file="ode_system_1.csv", status="replace", action="write")
  write(u_ode1, '(a)', advance="no") "t"
  do k_csv = 1, size(r)
    write(u_ode1, '(a, i0, a)', advance="no") ",r[", k_csv, "]"
  end do
  do k_csv = 1, size(v)
    write(u_ode1, '(a, i0, a)', advance="no") ",v[", k_csv, "]"
  end do
  write(u_ode1, '(a)') ""
  write(u_ode1, '(*(g0.17, :, ","))') t, transpose(r), transpose(v)
  do step = 1, 2000
    t_rk0 = t
    r_rk0 = r
    r_acc = 0.0_dp * r
    v_rk0 = v
    v_acc = 0.0_dp * v
    do stage = 1, 4
      r_rate = 0.0_dp * r
      do i = 1, int(N)
        r_rate(i, :) = v(i, :)
      end do
      v_rate = 0.0_dp * v
      do i = 1, int(N)
        s_sum1 = spread(0.0_dp, 1, 2)
        do j = 1, int(N)
          if (j /= i) then
            s_sum1 = s_sum1 + (G * m(j) * ((r(j, :) - r(i, :)) / norm2(r(j, :) - r(i, :))**3))
          end if
        end do
        v_rate(i, :) = s_sum1
      end do
      r_acc = r_acc + w_rk(stage) * r_rate
      v_acc = v_acc + w_rk(stage) * v_rate
      if (stage < 4) then
        t = t_rk0 + c_rk(stage) * h_rk
        r = r_rk0 + c_rk(stage) * h_rk * r_rate
        v = v_rk0 + c_rk(stage) * h_rk * v_rate
      end if
    end do
    t = t_rk0 + h_rk
    r = r_rk0 + h_rk / 6.0_dp * r_acc
    v = v_rk0 + h_rk / 6.0_dp * v_acc
    if (mod(step, 10) == 0) then
      write(u_ode1, '(*(g0.17, :, ","))') t, transpose(r), transpose(v)
    end if
  end do
  close(u_ode1)

  ! --- Stage 2 ---
  ! [EXPLICIT] Total energy: E = \sum_i \frac{1}{2} m_i \|\mathbf{v}_i\|^2 - \sum_{i<j} \frac{G m_i m_j}{\|\mathbf{r}_i - \math...
  s_sum2 = 0.0_dp
  do i = 1, int(N)
    s_sum2 = s_sum2 + (1.0_dp / 2.0_dp * m(i) * norm2(v(i, :))**2)
  end do
  s_sum3 = 0.0_dp
  do i = 1, int(N)
    s_sum4 = 0.0_dp
    do j = 1, int(N)
      if (i < j) then
        s_sum4 = s_sum4 + (G * m(i) * m(j) / norm2(r(i, :) - r(j, :)))
      end if
    end do
    s_sum3 = s_sum3 + (s_sum4)
  end do
  E = s_sum2 - s_sum3

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "v", v
  print '(a12, " = ", *(g0, 1x))', "t", t
  print '(a12, " = ", *(g0, 1x))', "r", r
  print '(a12, " = ", *(g0, 1x))', "G", G
  print '(a12, " = ", *(g0, 1x))', "m", m
  print '(a12, " = ", *(g0, 1x))', "E", E
  print '(a12, " = ", *(g0, 1x))', "N", N
end program solvermapp