import type { KBRef, CardRef } from './ref'

export interface CardInfo {
  ref: CardRef
  kbRef: KBRef
  name: string
  updatedAt?: string
}

export interface ICardStorage {
  listCards: (kbRef: KBRef) => Promise<CardInfo[]>
  GetCardInfo: (cardRef: CardRef) => Promise<CardInfo>
  createCard: (cardRef: CardRef, meta?: object | null) => Promise<CardRef>
  deleteCard: (cardRef: CardRef) => Promise<unknown>
  renameCard: (cardRef: CardRef, newName: string) => Promise<CardRef>
  countSubCards: (cardRef: CardRef) => Promise<number>
}
