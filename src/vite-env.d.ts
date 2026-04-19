/// <reference types="vite/client" />

// CSS Modules
declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}

// Legacy JS modules — silence implicit any
declare module '../../core/fs-backend'
declare module '../core/fs-backend'
declare module '../core/storage'
declare module '../../core/storage'
declare module '../core/git-backend'
declare module '../../core/git-backend'
declare module '../core/logger'
declare module '../../core/logger'
