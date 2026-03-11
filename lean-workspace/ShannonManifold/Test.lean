import ShannonManifold.PeanoAxioms

namespace MySpace

open MyNat

-- 보조 정리 1: add m zero = m
-- 덧셈의 정의에 의해 자명합니다.
theorem add_zero_right (m : MyNat) : add m zero = m :=
  rfl -- `rfl`은 정의에 의한 등식을 증명합니다.

-- 보조 정리 2: add zero m = m
-- `m`에 대한 귀납법으로 증명합니다.
theorem add_zero_left (m : MyNat) : add zero m = m := by
  induction m with
  | zero =>
    -- 목표: add zero zero = zero
    rfl
  | succ m' ih =>
    -- 목표: add zero (succ m') = succ m'
    -- 귀납 가정 (IH): add zero m' = m'
    calc
      add zero (succ m') = succ (add zero m') := rfl -- add의 정의에 의해
      _ = succ m' := by rw [ih] -- IH에 의해

-- 보조 정리 3: add (succ m) n = succ (add m n)
-- `n`에 대한 귀납법으로 증명합니다.
theorem add_succ_left (m n : MyNat) : add (succ m) n = succ (add m n) := by
  induction n with
  | zero =>
    -- 목표: add (succ m) zero = succ (add m zero)
    calc
      add (succ m) zero = succ m := rfl -- add의 정의에 의해
      _ = succ (add m zero) := by rw [add_zero_right m] -- add_zero_right에 의해
  | succ n' ih =>
    -- 목표: add (succ m) (succ n') = succ (add m (succ n'))
    -- 귀납 가정 (IH): add (succ m) n' = succ (add m n')
    calc
      add (succ m) (succ n') = succ (add (succ m) n') := rfl -- add의 정의에 의해
      _ = succ (succ (add m n')) := by rw [ih] -- IH에 의해
      _ = succ (add m (succ n')) := rfl -- add의 정의에 의해 (succ (add m n')는 add m (succ n')와 같습니다)

-- 덧셈의 교환법칙: add m n = add n m
-- `n`에 대한 귀납법으로 증명합니다.
theorem add_comm (m n : MyNat) : add m n = add n m := by
  induction n with
  | zero =>
    -- 목표: add m zero = add zero m
    calc
      add m zero = m := add_zero_right m
      _ = add zero m := (add_zero_left m).symm -- m = add zero m을 사용하기 위해 .symm 적용
  | succ n' ih =>
    -- 목표: add m (succ n') = add (succ n') m
    -- 귀납 가정 (IH): add m n' = add n' m
    calc
      add m (succ n') = succ (add m n') := rfl -- add의 정의에 의해
      _ = succ (add n' m) := by rw [ih] -- IH에 의해
      _ = add (succ n') m := (add_succ_left n' m).symm -- succ (add n' m) = add (succ n') m을 사용하기 위해 .symm 적용

end MySpace