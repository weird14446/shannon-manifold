namespace MySpace

inductive MyNat where
  | zero : MyNat
  | succ : MyNat → MyNat
  deriving Repr

open MyNat

axiom injective_succ : ∀ (m n : MyNat), succ m = succ n → m = n

def nat_to_mynat (n : Nat): MyNat :=
  match n with
  | Nat.zero => MyNat.zero
  | Nat.succ n' => MyNat.succ (nat_to_mynat n')

def mynat_to_nat (n : MyNat): Nat :=
  match n with
  | MyNat.zero => Nat.zero
  | MyNat.succ n' => Nat.succ (mynat_to_nat n')

def add (m : MyNat) (n : MyNat) : MyNat :=
  match n with
  | zero => m
  | succ n' => succ (add m n')