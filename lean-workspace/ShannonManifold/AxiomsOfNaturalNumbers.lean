inductive MyNat where
  | zero : MyNat
  | succ : MyNat → MyNat
  deriving Repr

open MyNat

axiom injective_succ : ∀ (m n : MyNat), succ m = succ n → m = n