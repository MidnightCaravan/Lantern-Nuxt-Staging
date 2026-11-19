<script setup lang="ts">
const props = defineProps<{ workId: number; initialVideoPath?: string | null; initialStatus?: string }>()
const emit = defineEmits<{ uploaded: [path: string] }>()
const videoPath = ref(props.initialVideoPath || '')
const selected = ref<File | null>(null)
const busy = ref(false)
const progress = ref(0)
const status = ref('')
const error = ref('')
const csrfToken = ref('')
const partSize = 16 * 1024 * 1024
const maxBytes = 2_000_000_000

async function ensureCsrf() {
  if (!csrfToken.value) {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  }
  return csrfToken.value
}

function xhrRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: BodyInit | null,
  onProgress?: (loaded: number) => void,
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)
    xhr.timeout = 300000
    Object.keys(headers || {}).forEach(key => xhr.setRequestHeader(key, headers[key]!))
    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress(event.loaded)
      })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr)
      else reject(new Error((xhr.responseText || 'Video upload failed.') + ` (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error. Check your connection and retry.'))
    xhr.ontimeout = () => reject(new Error('A video chunk timed out. Please retry.'))
    xhr.send(body)
  })
}

function chooseFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] || null
  selected.value = file
  error.value = ''
  progress.value = 0
  status.value = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : ''
}

async function uploadVideo() {
  if (!selected.value || busy.value) return
  const file = selected.value
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (!['mp4', 'webm', 'mov'].includes(extension)) { error.value = 'Choose an MP4, WebM, or MOV video.'; return }
  if (file.size < 1 || file.size > maxBytes) { error.value = 'Videos must be 2 GB or smaller.'; return }
  busy.value = true
  error.value = ''
  progress.value = 0
  let upload: { key: string; uploadId: string } | null = null
  try {
    const csrf = await ensureCsrf()
    status.value = 'Starting secure video upload…'
    const started = await $fetch<{ key: string; uploadId: string; partSize?: number }>(`/api/studio/works/${props.workId}/video-multipart/start`, { method: 'POST', body: { extension, size: file.size, csrfToken: csrf } })
    upload = started
    const chunkSize = Number(started.partSize) || partSize
    const count = Math.ceil(file.size / chunkSize)
    const parts: Array<{ partNumber: number; etag: string }> = []
    let confirmedBytes = 0
    for (let partNumber = 1; partNumber <= count; partNumber++) {
      const start = (partNumber - 1) * chunkSize
      const chunk = file.slice(start, Math.min(start + chunkSize, file.size))
      let result: { partNumber: number; etag: string } | null = null
      let lastError: unknown = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await xhrRequest('PUT', `/api/studio/works/${props.workId}/video-multipart/part`, {
            'X-CSRF-Token': csrf,
            'X-Lantern-Video-Key': started.key,
            'X-Lantern-Upload-Id': started.uploadId,
            'X-Lantern-File-Size': String(file.size),
            'X-Lantern-Part-Number': String(partNumber),
            'Content-Type': 'application/octet-stream',
          }, chunk, loaded => {
            const percent = Math.min(99, Math.floor(((confirmedBytes + loaded) / file.size) * 100))
            progress.value = percent
            status.value = `Uploading video: part ${partNumber} of ${count} (${percent}%)`
          })
          const partResult = JSON.parse(response.responseText) as { partNumber: number; etag: string }
          if (!partResult.etag || Number(partResult.partNumber) !== partNumber) {
            throw new Error('The server returned invalid part information.')
          }
          result = partResult
          break
        } catch (cause) {
          lastError = cause
          if (attempt < 3) status.value = `Retrying part ${partNumber} of ${count} (${attempt}/2)…`
        }
      }
      if (!result) throw lastError || new Error(`Could not upload part ${partNumber}.`)
      parts.push(result)
      confirmedBytes += chunk.size
      progress.value = Math.min(99, Math.floor((confirmedBytes / file.size) * 100))
    }
    const completed = await $fetch<{ videoPath: string }>(`/api/studio/works/${props.workId}/video-multipart/complete`, {
      method: 'POST', body: { key: started.key, uploadId: started.uploadId, size: file.size, parts, csrfToken: csrf },
    })
    videoPath.value = completed.videoPath
    emit('uploaded', completed.videoPath)
    progress.value = 100
    status.value = 'Video uploaded successfully.'
    selected.value = null
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.message || 'Video upload failed. Please try again.'
    status.value = 'Upload did not finish.'
    if (upload) {
      try {
        await $fetch(`/api/studio/works/${props.workId}/video-multipart/abort`, { method: 'POST', body: { ...upload, csrfToken: csrfToken.value } })
      } catch { /* R2 expires incomplete multipart uploads automatically. */ }
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="video-upload-panel" aria-labelledby="video-upload-title" style="margin-top:1.5rem;padding:1.25rem;border:1px solid var(--border);border-radius:12px;">
    <h2 id="video-upload-title">Video file</h2>
    <template v-if="videoPath">
      <p>Your video is uploaded. Preview it below.</p>
      <video controls playsinline preload="metadata" style="display:block;width:100%;max-height:65vh;background:#000;margin:1rem 0;" :src="videoPath">Your browser does not support HTML video.</video>
    </template>
    <p v-else>Upload a video file before publishing this work.</p>
    <div class="form-group">
      <label for="video-file">Choose a video (MP4, WebM, or MOV)</label>
      <input id="video-file" type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" :disabled="busy" @change="chooseFile">
      <small>Maximum file size: 2 GB. Large videos upload in 16 MiB chunks, and failed chunks are retried.</small>
    </div>
    <progress v-if="busy || progress" :value="progress" max="100" style="width:100%;"></progress>
    <p v-if="status" role="status" aria-live="polite">{{ status }}</p>
    <p v-if="error" class="flash error" role="alert">{{ error }}</p>
    <button type="button" class="button button-gold" :disabled="busy || !selected" @click="uploadVideo">{{ busy ? 'Uploading…' : 'Upload Video' }}</button>
  </section>
</template>
