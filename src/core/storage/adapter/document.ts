import type { CardRef } from './ref'

export interface IDocumentStorage {
  readCardMarkdown: (cardRef: CardRef) => Promise<string>
  writeCardMarkdown: (cardRef: CardRef, content: string) => Promise<unknown>
}
