# Throwaway test PKI — NOT Apple, NOT secret

Generated locally for `apple-jws.test.ts`. These certificates and keys exist so
the certificate-chain logic can be exercised against a real chain without a
network, and **they have no relationship to Apple's certificate authority**.

The private keys here are deliberately committed. They sign nothing that exists:
every subject is prefixed `TEST`, the roots are self-signed by this repo, and
nothing in the application ever loads this directory. Rotating or leaking them
costs nothing.

| File | What it is |
|---|---|
| `root.crt` | A self-signed root, standing in for Apple Root CA - G3 |
| `inter.crt` | Intermediate, signed by `root.crt` |
| `leaf.crt` / `leaf.key` | Signing certificate, signed by `inter.crt` |
| `rogue.crt` | A second self-signed root the verifier must never trust |
| `rogueleaf.crt` / `rogueleaf.key` | Leaf under the rogue root — a validly signed JWS that must still be rejected, because the chain does not reach a pinned root |
