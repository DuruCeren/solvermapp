program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: step, stage, it, j_nr
  real(dp), allocatable :: K(:, :)   ! [Input] (N/m) Stiffness
  real(dp), allocatable :: F(:)      ! [Input] (N) Load
  real(dp), allocatable :: u(:)      ! [Intermediate] (m) Displacement
  real(dp) :: E                      ! [Output] (J) Energy
  real(dp), allocatable :: r(:)      ! [Intermediate] (m) Same, by inverse
  real(dp), allocatable :: a(:)      ! [Input] (m) a
  real(dp), allocatable :: b(:)      ! [Input] (m) b
  real(dp), allocatable :: w(:)      ! [Output] (m^2) a x b
  real(dp) :: s                      ! [Output] (m^2) a . b
  real(dp) :: n_a                    ! [Output] (m) |a|
  real(dp), allocatable :: M(:, :)   ! [Input] (1/s) Rotation
  real(dp), allocatable :: y(:)      ! [State] (1) State
  real(dp) :: t                      ! [Input] (s) Time
  real(dp), allocatable :: c(:)      ! [Input] (1) Squares
  real(dp), allocatable :: z(:)      ! [Output] (1) Unknown
  real(dp), allocatable :: P(:, :)   ! [Output] (N^2/m^2) K K^T
  real(dp), allocatable :: q_(:)     ! [Output] (m) 2r + u
  real(dp) :: h_rk, t_rk0
  real(dp), allocatable :: z_new(:)
  real(dp), allocatable :: r_nr(:)
  real(dp), allocatable :: e_nr(:)
  real(dp), allocatable :: jac_nr(:, :)
  real(dp), allocatable :: y_rate(:)
  real(dp), allocatable :: y_rk0(:)
  real(dp), allocatable :: y_acc(:)
  real(dp), parameter :: w_rk(4) = [1.0_dp, 2.0_dp, 2.0_dp, 1.0_dp], c_rk(3) = [0.5_dp, 0.5_dp, 1.0_dp]

  ! --- Stage 0: inputs and start values of state variables ---
  K = reshape([4.0_dp, -1.0_dp, -1.0_dp, 3.0_dp], [2, 2], order=[2, 1])
  F = [1.0_dp, 2.0_dp]
  a = [1.0_dp, 2.0_dp, 3.0_dp]
  b = [4.0_dp, 5.0_dp, 6.0_dp]
  M = reshape([0.0_dp, 1.0_dp, -1.0_dp, 0.0_dp], [2, 2], order=[2, 1])
  y = [1.0_dp, 0.0_dp]
  c = [4.0_dp, 9.0_dp]

  ! --- Stage 1 ---
  ! [IMPLICIT] Stiffness system: \mathbf{K}\mathbf{u} = \mathbf{F}
  ! Newton–Raphson on the residual (left side - right side) = 0, solved for u
  ! Linear in u: solved directly
  u = solve(K, F)
  ! [EXPLICIT] Inverse solve: \mathbf{r} = \mathbf{K}^{-1}\mathbf{F}
  r = solve(K, F)
  ! [EXPLICIT] Cross product: \mathbf{w} = \mathbf{a} \times \mathbf{b}
  w = cross3(a, b)
  ! [EXPLICIT] Dot product: s = \mathbf{a} \cdot \mathbf{b}
  s = dot_product(a, b)
  ! [EXPLICIT] Norm: n_a = \|\mathbf{a}\|
  n_a = norm2(a)
  ! --- ODE system: y over t: RK4, 50 steps ---
  ! Rotation ODE: \frac{d\mathbf{y}}{dt} = \mathbf{M}\mathbf{y}
  t = 0.0_dp
  h_rk = (1.0_dp - t) / real(50, dp)
  do step = 1, 50
    t_rk0 = t
    y_rk0 = y
    y_acc = 0.0_dp * y
    do stage = 1, 4
      y_rate = matmul(M, y)
      y_acc = y_acc + w_rk(stage) * y_rate
      if (stage < 4) then
        t = t_rk0 + c_rk(stage) * h_rk
        y = y_rk0 + c_rk(stage) * h_rk * y_rate
      end if
    end do
    t = t_rk0 + h_rk
    y = y_rk0 + h_rk / 6.0_dp * y_acc
  end do
  ! [IMPLICIT] Nonlinear vector root: \mathbf{z} \odot \mathbf{z} = \mathbf{c}
  ! Newton–Raphson on the residual (left side - right side) = 0, solved for z
  if (.not. allocated(z)) allocate(z(2))
  z = 1.0_dp  ! initial guess
  do it = 1, 50
    r_nr = res_z(z)
    if (allocated(jac_nr)) deallocate(jac_nr)
    allocate(jac_nr(size(r_nr), size(z)))
    do j_nr = 1, size(z)
      e_nr = 0.0_dp * z
      e_nr(j_nr) = 1.0e-6_dp * max(abs(z(j_nr)), 1.0e-6_dp)
      jac_nr(:, j_nr) = (res_z(z + e_nr) - res_z(z - e_nr)) / (2.0_dp * e_nr(j_nr))
    end do
    z_new = z - solve(jac_nr, r_nr)
    if (maxval(abs(z_new - z)) < 1e-12_dp * (1.0_dp + maxval(abs(z)))) then
      z = z_new
      exit
    end if
    z = z_new
  end do
  if (it > 50) print *, "Warning: z did not converge in", 50, "iterations"
  ! [EXPLICIT] Gram matrix: \mathbf{P} = \mathbf{K}\mathbf{K}^T
  P = matmul(K, transpose(K))

  ! --- Stage 2 ---
  ! [EXPLICIT] Strain energy: E = \frac{1}{2}\mathbf{u}^T\mathbf{K}\mathbf{u}
  E = dot_product(matmul(1.0_dp / 2.0_dp * u, K), u)
  ! [EXPLICIT] Combination: \mathbf{q} = 2 \mathbf{r} + \mathbf{u}
  q_ = 2.0_dp * r + u

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "K", K
  print '(a12, " = ", *(g0, 1x))', "F", F
  print '(a12, " = ", *(g0, 1x))', "u", u
  print '(a12, " = ", *(g0, 1x))', "E", E
  print '(a12, " = ", *(g0, 1x))', "r", r
  print '(a12, " = ", *(g0, 1x))', "a", a
  print '(a12, " = ", *(g0, 1x))', "b", b
  print '(a12, " = ", *(g0, 1x))', "w", w
  print '(a12, " = ", *(g0, 1x))', "s", s
  print '(a12, " = ", *(g0, 1x))', "n_a", n_a
  print '(a12, " = ", *(g0, 1x))', "M", M
  print '(a12, " = ", *(g0, 1x))', "y", y
  print '(a12, " = ", *(g0, 1x))', "t", t
  print '(a12, " = ", *(g0, 1x))', "c", c
  print '(a12, " = ", *(g0, 1x))', "z", z
  print '(a12, " = ", *(g0, 1x))', "P", P
  print '(a12, " = ", *(g0, 1x))', "q_", q_

contains

  ! Residual of Nonlinear vector root: left side - right side
  function res_z(z) result(r)
    real(dp), intent(in) :: z(:)
    real(dp), allocatable :: r(:)
    r = z * z - c
  end function res_z

  ! Solves A x = b by Gaussian elimination with partial pivoting
  function solve(A, b) result(x)
    real(dp), intent(in) :: A(:, :), b(:)
    real(dp), allocatable :: x(:), M(:, :), row(:)
    integer :: n, i, k, p
    n = size(b)
    M = A
    x = b
    do k = 1, n
      p = k - 1 + maxloc(abs(M(k:n, k)), 1)
      if (p /= k) then
        row = M(k, :); M(k, :) = M(p, :); M(p, :) = row
        x([k, p]) = x([p, k])
      end if
      do i = k + 1, n
        x(i) = x(i) - M(i, k) / M(k, k) * x(k)
        M(i, k:n) = M(i, k:n) - M(i, k) / M(k, k) * M(k, k:n)
      end do
    end do
    do i = n, 1, -1
      x(i) = (x(i) - dot_product(M(i, i + 1:n), x(i + 1:n))) / M(i, i)
    end do
  end function solve

  function cross3(a, b) result(c)
    real(dp), intent(in) :: a(3), b(3)
    real(dp) :: c(3)
    c = [a(2) * b(3) - a(3) * b(2), a(3) * b(1) - a(1) * b(3), a(1) * b(2) - a(2) * b(1)]
  end function cross3
end program solvermapp