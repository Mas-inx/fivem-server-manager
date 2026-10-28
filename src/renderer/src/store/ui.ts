import { create } from 'zustand'
import type { UniversalAdmin } from '@shared/types'

interface UiState {
  newServer: boolean
  importServer: boolean
  duplicateId: string | null
  deleteId: string | null
  /** Admin being added or edited; an id means editing an existing one. */
  adminDraft: Partial<UniversalAdmin> | null
  open(dialog: 'newServer' | 'importServer'): void
  close(dialog: 'newServer' | 'importServer'): void
  setDuplicate(id: string | null): void
  setDelete(id: string | null): void
  editAdmin(draft: Partial<UniversalAdmin> | null): void
}

export const useUi = create<UiState>((set) => ({
  newServer: false,
  importServer: false,
  duplicateId: null,
  deleteId: null,
  adminDraft: null,
  open: (dialog) => set({ [dialog]: true } as Partial<UiState>),
  close: (dialog) => set({ [dialog]: false } as Partial<UiState>),
  setDuplicate: (duplicateId) => set({ duplicateId }),
  setDelete: (deleteId) => set({ deleteId }),
  editAdmin: (adminDraft) => set({ adminDraft })
}))
