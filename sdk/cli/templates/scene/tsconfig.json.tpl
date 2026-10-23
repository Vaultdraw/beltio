{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["node"],
    "paths": {
      "@vaultdraw/api": ["./vaultdraw/vaultdraw-api.d.ts"],
      "@vaultdraw/api/testing": ["./vaultdraw/testing/index.ts"]
    }
  },
  "include": ["src", "vaultdraw", "vitest.config.ts"]
}
