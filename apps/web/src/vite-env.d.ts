/// <reference types="vite/client" />

// CSS Modules
declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_TOPOMIND_SERVER_URL?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

import 'react'
declare module 'react' {
  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    inert?: string | undefined;
  }
}

export {}
