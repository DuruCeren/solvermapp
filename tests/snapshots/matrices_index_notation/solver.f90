program solvermapp
  implicit none
  integer, parameter :: dp = selected_real_kind(15, 307)
  integer :: i, j, k
  real(dp), allocatable :: H(:, :)   ! [Intermediate] (1) Hilbert matrix
  real(dp), allocatable :: b(:)      ! [Intermediate] (1) Row sums
  real(dp), allocatable :: x(:)      ! [Output] (1) Solution (all ones)
  real(dp), allocatable :: Q(:, :)   ! [Input] (1) Second matrix (identity)
  real(dp), allocatable :: C(:, :)   ! [Output] (1) H B
  real(dp) :: tau                    ! [Output] (1) Trace
  real(dp), allocatable :: d(:)      ! [Output] (1) Partial column sums
  real(dp) :: n                      ! [Input] (1) Size
  real(dp) :: s_sum1, s_sum2, s_sum3, s_sum4

  ! --- Stage 0: inputs and start values of state variables ---
  n = 6.0_dp
  Q = eye(int(n))

  ! --- Stage 1 ---
  ! [EXPLICIT] Hilbert matrix: H_{ij} = \frac{1}{i + j - 1}
  if (allocated(H)) deallocate(H)
  allocate(H(int(n), int(n)))
  do i = 1, int(n)
    do j = 1, int(n)
      H(i, j) = 1.0_dp / (real(i, dp) + real(j, dp) - 1.0_dp)
    end do
  end do

  ! --- Stage 2 ---
  ! [EXPLICIT] Row sums: b_i = \sum_j H_{ij}
  if (allocated(b)) deallocate(b)
  allocate(b(int(n)))
  do i = 1, int(n)
    s_sum1 = 0.0_dp
    do j = 1, int(n)
      s_sum1 = s_sum1 + (H(i, j))
    end do
    b(i) = s_sum1
  end do
  ! [EXPLICIT] Product: C_{ij} = \sum_k H_{ik} Q_{kj}
  if (allocated(C)) deallocate(C)
  allocate(C(int(n), int(n)))
  do i = 1, int(n)
    do j = 1, int(n)
      s_sum2 = 0.0_dp
      do k = 1, int(n)
        s_sum2 = s_sum2 + (H(i, k) * Q(k, j))
      end do
      C(i, j) = s_sum2
    end do
  end do
  ! [EXPLICIT] Trace: \tau = \sum_i H_{ii}
  s_sum3 = 0.0_dp
  do i = 1, int(n)
    s_sum3 = s_sum3 + (H(i, i))
  end do
  tau = s_sum3
  ! [EXPLICIT] Shifted: d_i = \sum_{j=1}^{i} H_{j1}
  if (allocated(d)) deallocate(d)
  allocate(d(int(n)))
  do i = 1, int(n)
    s_sum4 = 0.0_dp
    do j = 1, i
      s_sum4 = s_sum4 + (H(j, 1))
    end do
    d(i) = s_sum4
  end do

  ! --- Stage 3 ---
  ! [EXPLICIT] Solve: \mathbf{x} = H^{-1} b
  x = solve(H, b)

  ! --- Results ---
  print '(a12, " = ", *(g0, 1x))', "H", H
  print '(a12, " = ", *(g0, 1x))', "b", b
  print '(a12, " = ", *(g0, 1x))', "x", x
  print '(a12, " = ", *(g0, 1x))', "Q", Q
  print '(a12, " = ", *(g0, 1x))', "C", C
  print '(a12, " = ", *(g0, 1x))', "tau", tau
  print '(a12, " = ", *(g0, 1x))', "d", d
  print '(a12, " = ", *(g0, 1x))', "n", n

contains

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

  function eye(n) result(E)
    integer, intent(in) :: n
    real(dp), allocatable :: E(:, :)
    integer :: i
    allocate(E(n, n))
    E = 0.0_dp
    do i = 1, n
      E(i, i) = 1.0_dp
    end do
  end function eye
end program solvermapp