import { ref, onMounted } from 'vue'

export type StatusIndicator = 'none' | 'new' | 'error'

const STORAGE_KEY = 'arc:announcement-last-viewed'

const announcementStatus = ref<StatusIndicator>('none')
const updateStatus = ref<StatusIndicator>('none')
let latestAnnouncementDate = ''
let checked = false

async function checkAnnouncements(): Promise<void> {
  try {
    const res = await window.characterArc.fetchAnnouncements()
    if (!res.success || !res.data?.length) {
      announcementStatus.value = 'error'
      return
    }
    const dates = res.data.map((item) => item.date).sort()
    latestAnnouncementDate = dates[dates.length - 1]
    const lastViewed = localStorage.getItem(STORAGE_KEY) ?? ''
    announcementStatus.value = latestAnnouncementDate > lastViewed ? 'new' : 'none'
  } catch {
    announcementStatus.value = 'error'
  }
}

async function checkUpdate(): Promise<void> {
  try {
    const result = await window.characterArc.checkUpdate()
    if (!result.success) {
      updateStatus.value = 'error'
      return
    }
    updateStatus.value = result.result?.hasUpdate ? 'new' : 'none'
  } catch {
    updateStatus.value = 'error'
  }
}

function markAnnouncementRead(): void {
  if (latestAnnouncementDate) {
    localStorage.setItem(STORAGE_KEY, latestAnnouncementDate)
  }
  announcementStatus.value = 'none'
}

function markUpdateRead(): void {
  updateStatus.value = 'none'
}

export function useStartupCheck() {
  onMounted(() => {
    if (!checked) {
      checked = true
      checkAnnouncements()
      checkUpdate()
    }
  })

  return {
    announcementStatus,
    updateStatus,
    markAnnouncementRead,
    markUpdateRead
  }
}
