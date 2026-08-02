/*
  GENERATED — do not edit. Rebuild with `npm run build:images`.

  A 32px WebP of each demo photograph, inlined as a data URI.

  `VehicleIdentity` paints its photo twice: an over-scanned blurred fill under
  a contained sharp copy. Before this, both layers decoded the same full-size
  file — the audit's F7, and worst on the phones least able to afford it. The
  fill is blurred by 34px, so it never needed those pixels; 32 across upscales
  and blurs to something the eye cannot tell from the original.

  Keyed by the JPEG's public path, which is what `planVehiclePhoto` returns
  for a demo vehicle. Owner uploads arrive as signed URLs and have no entry —
  callers fall back to the identity plate, which is already the design for a
  photograph that has not arrived.
*/

export const VEHICLE_BLUR_DATA: Record<string, string> = {
  '/vehicles/accord/card-800.jpg':
    'data:image/webp;base64,UklGRtQAAABXRUJQVlA4IMgAAACwBACdASogABUAPrVKnkmnJCKhMAgA4BaJZgC90YukzYNJA9yccUSN66+b2KaAAP5bTfAK0dxgDxLsXvW3l8ax9BSu6SzzrCdG7zETKxEzlvsa7XDV5YGfmOVTnvOCCrysoX/KBYRkMHhY1Tu6f7AYUhPhIYVasgj+KHRN1CfTYAzS2/7q9lfl8cnmxvWFnz2GDi+UhZePVgnMtxPRiMtsCYejl86ZA3m6w3Aj3a3AkDieGbcudFfcZDWE4l5s8pPei24mH8AAAA==',
  '/vehicles/accord/detail-4x3.jpg':
    'data:image/webp;base64,UklGRtwAAABXRUJQVlA4INAAAABQBQCdASogABgAPrVOoEsnJCMhsBgIAOAWiUAYUYIARIoW98X1emAwQQqPPPJ4wEzjeAAA/mFRIPs0k1ueOqPoqHg56a465Fj/8TS6hAcqe637ppaHMVf2xbXqCsU5HRG57ooCsIuHsW87jGlZ8gxI5NNeO9+ru0fDZhNoOcBkfGHmFWKgxj/NHC+z+o7b+NNZssuaoGrFgcNKqQ5zdMc8sTTw7yvBTG/h6Y7GKyfCO5DvCE+SKsuD77VBit/65mIAEi7T4JN0m41RXp5XbVAA',
  '/vehicles/accord/hero-3x2.jpg':
    'data:image/webp;base64,UklGRswAAABXRUJQVlA4IMAAAACQBACdASogABUAPrVKnkmnJCKhMAgA4BaJZgC7AYvgjM6Ct+69GmU8ph1VeQAA/ltN8A1sQcQeDQ+kwt9sc71M0/A2T6fMHdne8PRQlNyPbZyKq3znerR016DKZmnZQv+UGrni/ngvYB+P7AYUhPhIYVasgj+KHRN1CfTYBD4Pvjj7nPIanm/aWLOSJKMNH4yIYpYpL65dcd2eRIZNpPWkSBw7Golw78Yn+1fJy50V9xkNYTiXUOKhAyFPglCKYAA=',
  '/vehicles/accord/portrait-3x4.jpg':
    'data:image/webp;base64,UklGRggBAABXRUJQVlA4IPwAAACQBgCdASogACsAPrVQoUsnJKMhqqoA4BaJZADBCqAEKCU1DAKSV5j/cajDY8zNzOit9B6li8SGz7id9eAAAP7zoMHAvv+VlZ25UhReHMOg8GyuL/NjRYAERDufjtaaeahmLWZaDMNdTl8vrCSobFd8dvyXeq64c615WzD40N9yH8/U2lX0lDS/zVOnRj3hsSrin3ymW+RbSQg7cRZ9OsfvuChaU63wZv2kRcdaUpEhWpXfcEk8OBER8YGnHhdjzP2Gk/B9OyC8/4J6KbEA6TEhNk1B821jAmHpzOTr9i8+79EEy8bwtb3ezxkAc4lshHSPmeWLRyJRMV5EwAA=',
  '/vehicles/m3/card-800.jpg':
    'data:image/webp;base64,UklGRuwAAABXRUJQVlA4IOAAAAAwBgCdASogABUAPrVMnkmnJCKhMAgA4BaJYwC2zHkQbTGItkH1QaqUS+POZfX9Ny7RsR2njYjJIlYAAP7kYWCSiP2BTu50M8RT0JCeIuxmANheN0gTqOTsMtkKggnjdyEMa0YwKNKCD4GuX41JlEYljKqQ7FtLbLCwP6B6f9seQmJukgn8GTNBU0kjCIgRXqVJjGQfEHcV8jXQTB9wifuJcToL1z6ClQ/F0QiI7/f4C4Dbr6ZeZHpjAPIU2/5ZJ+YJxcLVeYidgoWsd6ggZFBOdvzaKzPEqwwQUFvsViQAAA==',
  '/vehicles/m3/detail-4x3.jpg':
    'data:image/webp;base64,UklGRugAAABXRUJQVlA4INwAAADwBQCdASogABgAPrFKn0mnJKMhMBgMAOAWCWMAuDW2ANuQsIDGGRIcpjQF0NFiv2RDNO27jBpGAAD+9dYZrCwE9NW6h+xxBd7uWem2pK/8YQKhzNIjqfsVnVOZF0t19+pzPrSY1Hkx0DP22wvZmAbPtaxut66dasWWVKwv/UNMoUlFMtLCw0eeUnBs+KsKAC+punQiohIOx30+2Oee8O6n2JxZp2GMU60Y0FdXiXQuIMC7ZvU6BqsqQSZsXiq8np3ODSaSCoKIoOe02eJ+L4FoL6VRjVJ0gBObQAAA',
  '/vehicles/m3/hero-3x2.jpg':
    'data:image/webp;base64,UklGRuoAAABXRUJQVlA4IN4AAADQBQCdASogABUAPrVMn0snJCKhsBgIAOAWiWMAvOHcxG6I6k6MqjcD+xGaVvbQERpu4D+0v0IIAP7pXxcftwOpseu7dd7mIMIwey9Q11ZF21f8vWe9n9G+CqDr++j1kNSzW50v4Ou2ACWQUeucV7dxnvVv80nD7ciZxe+v51YzVETJrmkbse3FG9hL6b1XHFjRE8Qjl2xmj3i15VPxh1X5lqwpxY2P3c8IocXDRZmP4p8c9V1L9XDMYsfqkP7CnNZCUZQZUlFYni3om7h+QGMRLTMip9gSlR4asjgAAAA=',
  '/vehicles/m3/portrait-3x4.jpg':
    'data:image/webp;base64,UklGRngBAABXRUJQVlA4IGwBAAAwCACdASogACsAPrFGnUmnI6KhNVgIAOAWCWUAstGwpUxJXrnYGfsKb8W3zzqJ2wvLVp2PQ0i2RiBB0caGYFADt28dsh08XpSAAAD9wg7CvrdB96BITLP6JzGHrRw3Ajiat6biCKQmbkUC5oyZHj4fEizUTuJV1DRVIAL6mpR8LDmb00XMFf3mrivlBaposRZBecDz8a8FVjA/X5b8zdEm49rbPTibxPDaz8G0gvy54qpG7uSvDMD5woae9ejZ3DapWoaMkenmjlEohRtN//cdnBLqbR5PfAhMi2We69AtKcz8Z31vrpHQ+SheftvHa1U+2M8rxjU1ThYeJVY8zaf409p5EUQW7gRbP4V5Cymj6WqRPSxU0Br4aN4gKn0h6JC0h+sdF8O3S8ARcn6XXYRdGAkmCwnfWeFY/sbvvdOuzORoJQxqiQFofUaF1TFP8mW6DgUkldB5ztbWcFzLFz0srltCLFsnd4x/QcAA',
  '/vehicles/wrx/card-800.jpg':
    'data:image/webp;base64,UklGRswAAABXRUJQVlA4IMAAAAAQBgCdASogABUAPrVKnkmnJCKhMAgA4BaJYwCzst9OAbWpB4F/laixJWGLKr5rRoyOd4wCxvGin8gA/sclRbj0WzBlcMb+x0qgyg/eegIoAZt2UaFN+HY1U2ENqJkU2jA1gEctu/n8Cu5sKLgW3AC1yXiMc1wXaD4nJx5oqNOhB7fax7zZFF4+eYTN8iQZBcws4esYQ9l/JPTBvmkFllVOApkNq5SlIwnawaOo+S2r49XI73BzBQ+i0bgezB8x4AA=',
  '/vehicles/wrx/detail-4x3.jpg':
    'data:image/webp;base64,UklGRmgBAABXRUJQVlA4IFwBAADwBgCdASogABgAPrVSoEynJKMiKAqo4BaJaACdMyYBVhTTaA0wbPaMGdpcMQjxL6RLKjDAXfkWyqyPSHKUnaAAAPwqx3n1qvSYeWJmyTy3WZrV+A2wnZzH99PgqDujHba9tWOqYWmymOdYyXdsgMHcd8OXIApPE74hgKADG0g3Du4sAOTbPuoYVCX5Jam/jqt9x12HoQ6BFHBvNhd/G1ormtM3Nsq3jx+KYwLwi4b22GO2ZhSL7QVYJs+uFiY29Cb7CSOHOv4ffTseKq0pcsjKua6dMEsWG1T3q3F99S4OvzjCO5bvGpWJPG32KaLpXcdoXo5y5L0FyEeAyMwXsvagnfi20eOtH7JQaWuirDRZ3FXEsyFsLrw8p77/336J7CS2hijzvXOGT29PQey040UPeLdEH/Nf2XG9cIWQlVOgAwHWl8EPCkSUgoCHt5r0AQN5jOTfkThtYMr30AA=',
  '/vehicles/wrx/hero-3x2.jpg':
    'data:image/webp;base64,UklGRs4AAABXRUJQVlA4IMIAAADQBQCdASogABUAPrVMn0mnJKKhMAgA4BaJYwCw83gN0Ab5t0XbGN1E2mz4nopoSkD80oNLi8iAAP7HJvU3pvZFYckgycZ1/pvaJ2bTqugUK6qrWytSTwGoM4RbP+ow7hO7PVunPgzlUyIg9JBJKyDf5Kx17+qnMVG42LDYx7c8EReWbpf38hsHndXW+FuXMz2gVWQEPztvaRDISsfIQ1vFOShxt/IXFiFzC6wWpb4eq6ufRIlRzIT9yxT1MSIDFoGsAA==',
  '/vehicles/wrx/portrait-3x4.jpg':
    'data:image/webp;base64,UklGRi4BAABXRUJQVlA4ICIBAACwBgCdASogACsAPrVOo0snJCMhqqoA4BaJZwCvDdzdiBvWVbQJwQEHkzT4972rTorevdLqzRNTY0shY4OnAAD+11GoPcfJCdpyYHAnydBVOXlEANE2wiGph6F5vfvDmNkX5DJ/2lYZwanOHb3x1uDipNufL0f07gWEn5+gjLI+Z4EPYQqsG2/eMWct3LQRMySHVEXnJimFuM8RNjGFO0OJEAPTQzp+Hdm3YuYE7GFkjaHaXh77wRf9jW01FItC2+vbAv6pk8HNUA5xF42CltZv31tG1N8GOdSVBV0DGhGDVEiyuhYxmn6+pSEA+2cXCgefdo9hhpcdjQdRL2LdlfOBMVCPscBORgqvL2DnWCLxh6ETzjAOw2YDAIBISGv3GSAAAA==',
};

/** The placeholder for a photo path, if one was built for it. */
export function vehicleBlurData(src: string | null | undefined): string | null {
  if (!src) return null;
  return VEHICLE_BLUR_DATA[src] ?? null;
}
