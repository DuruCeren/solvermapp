program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, stage, u_ode1, k_csv
  real(dp), allocatable :: v_1(:)    ! [State] (m/s) Velocity of body 1
  real(dp) :: t                      ! [Input] (s) Time
  real(dp), allocatable :: r_1(:)    ! [State] (m) Position of body 1
  real(dp), allocatable :: v_2(:)    ! [State] (m/s) Velocity of body 2
  real(dp), allocatable :: r_2(:)    ! [State] (m) Position of body 2
  real(dp), allocatable :: v_3(:)    ! [State] (m/s) Velocity of body 3
  real(dp), allocatable :: r_3(:)    ! [State] (m) Position of body 3
  real(dp) :: G                      ! [Input] (m^3/(kg s^2)) Gravitational constant (normalised)
  real(dp) :: m_2                    ! [Input] (kg) Mass of body 2
  real(dp) :: m_3                    ! [Input] (kg) Mass of body 3
  real(dp) :: m_1                    ! [Input] (kg) Mass of body 1
  real(dp) :: E                      ! [Output] (J) Total energy
  real(dp) :: h_rk, t_rk0
  real(dp), allocatable :: r_1_rate(:)
  real(dp), allocatable :: r_1_rk0(:)
  real(dp), allocatable :: r_1_acc(:)
  real(dp), allocatable :: r_2_rate(:)
  real(dp), allocatable :: r_2_rk0(:)
  real(dp), allocatable :: r_2_acc(:)
  real(dp), allocatable :: r_3_rate(:)
  real(dp), allocatable :: r_3_rk0(:)
  real(dp), allocatable :: r_3_acc(:)
  real(dp), allocatable :: v_1_rate(:)
  real(dp), allocatable :: v_1_rk0(:)
  real(dp), allocatable :: v_1_acc(:)
  real(dp), allocatable :: v_2_rate(:)
  real(dp), allocatable :: v_2_rk0(:)
  real(dp), allocatable :: v_2_acc(:)
  real(dp), allocatable :: v_3_rate(:)
  real(dp), allocatable :: v_3_rk0(:)
  real(dp), allocatable :: v_3_acc(:)
  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]

  ! --- Stage 0: inputs and start values of state variables ---
  G = 1.0_dp
  m_2 = 1.0_dp
  m_3 = 1.0_dp
  m_1 = 1.0_dp
  v_1 = [0.466203685_dp, 0.43236573_dp]
  r_1 = [0.97000436_dp, -0.24308753_dp]
  v_2 = [0.466203685_dp, 0.43236573_dp]
  r_2 = [-0.97000436_dp, 0.24308753_dp]
  v_3 = [-0.93240737_dp, -0.86473146_dp]
  r_3 = [0.0_dp, 0.0_dp]

  ! --- Stage 1 ---
  ! --- ODE system: r_1, r_2, r_3, v_1, v_2, v_3 over t: RK4, 2000 steps ---
  ! Position of body 1: \frac{d\mathbf{r}_1}{dt} = \mathbf{v}_1
  ! Position of body 2: \frac{d\mathbf{r}_2}{dt} = \mathbf{v}_2
  ! Position of body 3: \frac{d\mathbf{r}_3}{dt} = \mathbf{v}_3
  ! Velocity of body 1: \frac{d\mathbf{v}_1}{dt} = G m_2 \frac{\mathbf{r}_2 - \mathbf{r}_1}{\|\mathbf{r}_2 - \mathbf{r}_1\|^3} ...
  ! Velocity of body 2: \frac{d\mathbf{v}_2}{dt} = G m_1 \frac{\mathbf{r}_1 - \mathbf{r}_2}{\|\mathbf{r}_1 - \mathbf{r}_2\|^3} ...
  ! Velocity of body 3: \frac{d\mathbf{v}_3}{dt} = G m_1 \frac{\mathbf{r}_1 - \mathbf{r}_3}{\|\mathbf{r}_1 - \mathbf{r}_3\|^3} ...
  t = 0.0_dp
  h_rk = (6.32591398_dp - t) / real(2000, dp)
  ! Solution every 10 steps -> ode_system_1.csv
  open(newunit=u_ode1, file="ode_system_1.csv", status="replace", action="write")
  write(u_ode1, '(a)', advance="no") "t"
  do k_csv = 1, size(r_1)
    write(u_ode1, '(a, i0, a)', advance="no") ",r_1[", k_csv, "]"
  end do
  do k_csv = 1, size(r_2)
    write(u_ode1, '(a, i0, a)', advance="no") ",r_2[", k_csv, "]"
  end do
  do k_csv = 1, size(r_3)
    write(u_ode1, '(a, i0, a)', advance="no") ",r_3[", k_csv, "]"
  end do
  do k_csv = 1, size(v_1)
    write(u_ode1, '(a, i0, a)', advance="no") ",v_1[", k_csv, "]"
  end do
  do k_csv = 1, size(v_2)
    write(u_ode1, '(a, i0, a)', advance="no") ",v_2[", k_csv, "]"
  end do
  do k_csv = 1, size(v_3)
    write(u_ode1, '(a, i0, a)', advance="no") ",v_3[", k_csv, "]"
  end do
  write(u_ode1, '(a)') ""
  write(u_ode1, '(*(g0.17, :, ","))') t, r_1, r_2, r_3, v_1, v_2, v_3
  do step = 1, 2000
    t_rk0 = t
    r_1_rk0 = r_1
    r_1_acc = 0.0_dp * r_1
    r_2_rk0 = r_2
    r_2_acc = 0.0_dp * r_2
    r_3_rk0 = r_3
    r_3_acc = 0.0_dp * r_3
    v_1_rk0 = v_1
    v_1_acc = 0.0_dp * v_1
    v_2_rk0 = v_2
    v_2_acc = 0.0_dp * v_2
    v_3_rk0 = v_3
    v_3_acc = 0.0_dp * v_3
    do stage = 1, 4
      r_1_rate = v_1
      r_2_rate = v_2
      r_3_rate = v_3
      v_1_rate = G * m_2 * ((r_2 - r_1) / norm2(r_2 - r_1)**3) + G * m_3 * ((r_3 - r_1) / norm2(r_3 - r_1)**3)
      v_2_rate = G * m_1 * ((r_1 - r_2) / norm2(r_1 - r_2)**3) + G * m_3 * ((r_3 - r_2) / norm2(r_3 - r_2)**3)
      v_3_rate = G * m_1 * ((r_1 - r_3) / norm2(r_1 - r_3)**3) + G * m_2 * ((r_2 - r_3) / norm2(r_2 - r_3)**3)
      r_1_acc = r_1_acc + w_rk(stage) * r_1_rate
      r_2_acc = r_2_acc + w_rk(stage) * r_2_rate
      r_3_acc = r_3_acc + w_rk(stage) * r_3_rate
      v_1_acc = v_1_acc + w_rk(stage) * v_1_rate
      v_2_acc = v_2_acc + w_rk(stage) * v_2_rate
      v_3_acc = v_3_acc + w_rk(stage) * v_3_rate
      if (stage < 4) then
        t = t_rk0 + c_rk(stage) * h_rk
        r_1 = r_1_rk0 + c_rk(stage) * h_rk * r_1_rate
        r_2 = r_2_rk0 + c_rk(stage) * h_rk * r_2_rate
        r_3 = r_3_rk0 + c_rk(stage) * h_rk * r_3_rate
        v_1 = v_1_rk0 + c_rk(stage) * h_rk * v_1_rate
        v_2 = v_2_rk0 + c_rk(stage) * h_rk * v_2_rate
        v_3 = v_3_rk0 + c_rk(stage) * h_rk * v_3_rate
      end if
    end do
    t = t_rk0 + h_rk
    r_1 = r_1_rk0 + h_rk / 6.0_dp * r_1_acc
    r_2 = r_2_rk0 + h_rk / 6.0_dp * r_2_acc
    r_3 = r_3_rk0 + h_rk / 6.0_dp * r_3_acc
    v_1 = v_1_rk0 + h_rk / 6.0_dp * v_1_acc
    v_2 = v_2_rk0 + h_rk / 6.0_dp * v_2_acc
    v_3 = v_3_rk0 + h_rk / 6.0_dp * v_3_acc
    if (mod(step, 10) == 0) then
      write(u_ode1, '(*(g0.17, :, ","))') t, r_1, r_2, r_3, v_1, v_2, v_3
    end if
  end do
  close(u_ode1)

  ! --- Stage 2 ---
  ! [EXPLICIT] Total energy: E = \frac{1}{2} m_1 \|\mathbf{v}_1\|^2 + \frac{1}{2} m_2 \|\mathbf{v}_2\|^2 + \frac{1}{2} m_3 \|\m...
  E = 1.0_dp / 2.0_dp * m_1 * norm2(v_1)**2 + 1.0_dp / 2.0_dp * m_2 * norm2(v_2)**2 + 1.0_dp / 2.0_dp * m_3 * &
      & norm2(v_3)**2 - G * m_1 * m_2 / norm2(r_1 - r_2) - G * m_1 * m_3 / norm2(r_1 - r_3) - G * m_2 * m_3 / &
      & norm2(r_2 - r_3)

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "v_1", v_1
  print '(a12, " = ", *(g0, 1x))', "t", t
  print '(a12, " = ", *(g0, 1x))', "r_1", r_1
  print '(a12, " = ", *(g0, 1x))', "v_2", v_2
  print '(a12, " = ", *(g0, 1x))', "r_2", r_2
  print '(a12, " = ", *(g0, 1x))', "v_3", v_3
  print '(a12, " = ", *(g0, 1x))', "r_3", r_3
  print '(a12, " = ", *(g0, 1x))', "G", G
  print '(a12, " = ", *(g0, 1x))', "m_2", m_2
  print '(a12, " = ", *(g0, 1x))', "m_3", m_3
  print '(a12, " = ", *(g0, 1x))', "m_1", m_1
  print '(a12, " = ", *(g0, 1x))', "E", E
end program solvermapp