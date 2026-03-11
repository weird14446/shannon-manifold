namespace ShannonManifold

def pythagoreanStatement : Prop :=
  ∀ a b c : Nat, a * a + b * b = c * c -> True

theorem trivialRightTriangleWitness : True := by
  trivial

end ShannonManifold
