import { computed, ref, watch, type ComputedRef } from 'vue'

export function useBatchSelection(availableIds: ComputedRef<string[]>) {
  const selectionMode = ref(false)
  const selectedIds = ref<Set<string>>(new Set())
  const selectedAvailableIds = computed(() =>
    availableIds.value.filter((id) => selectedIds.value.has(id))
  )
  const allAvailableSelected = computed(() =>
    availableIds.value.length > 0 && selectedAvailableIds.value.length === availableIds.value.length
  )

  watch(availableIds, (ids) => {
    const available = new Set(ids)
    selectedIds.value = new Set([...selectedIds.value].filter((id) => available.has(id)))
  })

  function toggleSelectionMode(): void {
    selectionMode.value = !selectionMode.value
    if (!selectionMode.value) selectedIds.value = new Set()
  }

  function toggleSelection(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function toggleSelectAll(): void {
    const next = new Set(selectedIds.value)
    if (allAvailableSelected.value) availableIds.value.forEach((id) => next.delete(id))
    else availableIds.value.forEach((id) => next.add(id))
    selectedIds.value = next
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
  }

  function finishSelection(): void {
    clearSelection()
    selectionMode.value = false
  }

  return {
    selectionMode,
    selectedIds,
    selectedAvailableIds,
    allAvailableSelected,
    toggleSelectionMode,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    finishSelection
  }
}
