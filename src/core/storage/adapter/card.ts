import type { KBRef } from './kb'

export type CardRef = string

export interface CardInfo {
  ref: CardRef
  name: string
  updatedAt?: string
}

export interface ICardStorage {
  /**
   * List the cards in the knowledge base
   * @param kbRef - The reference of the knowledge base
   * @returns The list of cards
   */
  listCards: (kbRef: KBRef) => Promise<CardInfo[]>

  /**
   * Create a new card
   * @param kbRef - The reference of the knowledge base
   * @param name - The name of the card
   * @returns The reference of the card
   */
  createCard: (kbRef: KBRef, name: string) => Promise<CardInfo>

  /**
   * Delete a card
   * @param cardRef - The information of the card
   * @returns void
   */
  deleteCard: (cardRef: CardRef) => Promise<void>

  /**
   * Rename a card
   * @param cardInfo - The information of the card
   * @param newName - The new name of the card
   * @returns void
   */
  renameCard: (cardRef: CardRef, newName: string) => Promise<void>

  /**
   * Count the number of sub-cards
   * @param cardInfo - The information of the card
   * @returns The number of sub-cards
   */
  countSubCards: (cardRef: CardRef) => Promise<number>
}
