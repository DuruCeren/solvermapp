program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, stage, j, i
  real(dp), allocatable :: K(:, :)   ! [Input] (1/s) Rate matrix (columns sum to 0)
  real(dp), allocatable :: c(:)      ! [State] (mol/m^3) Concentrations
  real(dp) :: t                      ! [Input] (s) Time
  real(dp) :: c_tot                  ! [Output] (mol/m^3) Total concentration
  real(dp) :: M                      ! [Input] (1) Number of species
  real(dp) :: h_rk, t_rk0, s_sum1, s_sum2
  real(dp), allocatable :: c_rate(:)
  real(dp), allocatable :: c_rk0(:)
  real(dp), allocatable :: c_acc(:)
  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]

  ! --- Stage 0: inputs and start values of state variables ---
  M = 3.0_dp
  K = reshape([-2.0_dp, 0.0_dp, 0.0_dp, 1.5_dp, -1.0_dp, 0.5_dp, 0.5_dp, 1.0_dp, -0.5_dp], [3, 3], order=[2, 1])
  c = [1.0_dp, 0.0_dp, 0.0_dp]

  ! --- Stage 1 ---
  ! --- ODE system: c over t: RK4, 200 steps ---
  ! Species balance: \frac{dc_i}{dt} = \sum_j K_{ij} c_j
  t = 0.0_dp
  h_rk = (2.0_dp - t) / real(200, dp)
  do step = 1, 200
    t_rk0 = t
    c_rk0 = c
    c_acc = 0.0_dp * c
    do stage = 1, 4
      c_rate = 0.0_dp * c
      do i = 1, int(M)
        s_sum1 = 0.0_dp
        do j = 1, int(M)
          s_sum1 = s_sum1 + (K(i, j) * c(j))
        end do
        c_rate(i) = s_sum1
      end do
      c_acc = c_acc + w_rk(stage) * c_rate
      if (stage < 4) then
        t = t_rk0 + c_rk(stage) * h_rk
        c = c_rk0 + c_rk(stage) * h_rk * c_rate
      end if
    end do
    t = t_rk0 + h_rk
    c = c_rk0 + h_rk / 6.0_dp * c_acc
  end do

  ! --- Stage 2 ---
  ! [EXPLICIT] Total: c_{tot} = \sum_i c_i
  s_sum2 = 0.0_dp
  do i = 1, int(M)
    s_sum2 = s_sum2 + (c(i))
  end do
  c_tot = s_sum2

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "K", K
  print '(a12, " = ", *(g0, 1x))', "c", c
  print '(a12, " = ", *(g0, 1x))', "t", t
  print '(a12, " = ", *(g0, 1x))', "c_tot", c_tot
  print '(a12, " = ", *(g0, 1x))', "M", M
end program solvermapp