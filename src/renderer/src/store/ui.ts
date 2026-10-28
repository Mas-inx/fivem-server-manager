import { create } from 'zustand'

interface UiState {
  newServer: boolean
  importServer: boolean
  duplicateId: string | null
  deleteId: string | null
  open(dialog: 'newServer' | 'importServer'): void
  close(dialog: 'newServer' | 'importServer'): void
  setDuplicate(id: string | null): void
  setDelete(id: string | null): void
}

export const useUi = create<UiState>((set) => ({
  newServer: false,
  importServer: false,
  duplicateId: null,
  deleteId: null,
  open: (dialog) => set({ [dialog]: true } as Partial<UiState>),
  close: (dialog) => set({ [dialog]: false } as Partial<UiState>),
  setDuplicate: (duplicateId) => set({ duplicateId }),
  setDelete: (deleteId) => set({ deleteId })
}))
