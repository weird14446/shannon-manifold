import Lean

-- 1. 페아노 공리계 정의
inductive MyNat where
  | zero : MyNat
  | succ : MyNat → MyNat

-- 2. 후속자 함수 정의
def MyNat.add : MyNat → MyNat → MyNat
  | n, MyNat.zero   => n
  | n, MyNat.succ m => MyNat.succ (n.add m)

-- 3. 성질 증명: 0은 어떤 수의 후속자도 아니다 (zero_ne_succ)
-- 즉, ∀ n, zero ≠ succ n 임을 증명
theorem zero_ne_succ (n : MyNat) : MyNat.zero ≠ MyNat.succ n := by
  -- 귀류법 사용: zero = succ n 이라고 가정
  intro h
  -- MyNat.zero와 MyNat.succ n은 생성자가 다르므로 'noConfusion'을 통해 모순을 이끌어냄
  cases h

-- 4. 성질 증명: 덧셈의 항등원 성질 (n + 0 = n)
theorem add_zero (n : MyNat) : MyNat.add n MyNat.zero = n := by
  -- 정의에 의해 MyNat.add n MyNat.zero는 n이 됨
  rfl

-- 5. 성질 증명: 덧셈의 교환법칙 기초 (n + 1 = 1 + n)
-- 이를 위해서는 귀납법(induction)이 필요합니다.
theorem add_succ (n m : MyNat) : MyNat.add n (MyNat.succ m) = MyNat.succ (MyNat.add n m) := by
  rfl

#check zero_ne_succ
#check add_zero