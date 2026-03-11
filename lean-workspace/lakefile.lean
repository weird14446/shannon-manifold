import Lake
open Lake DSL

package shannonManifold where
  leanOptions := #[
    ⟨`pp.unicode.fun, true⟩
  ]

@[default_target]
lean_lib ShannonManifold where
