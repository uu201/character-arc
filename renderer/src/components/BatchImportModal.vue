<script setup lang="ts">
import { NButton, NModal, NCard, NProgress, NTag } from 'naive-ui'
import { RefreshCw, X } from 'lucide-vue-next'
import { useBatchImport } from '@/composables/useBatchImport'

const {
  showModal,
  stage,
  pickedFiles,
  concurrency,
  bookList,
  completedCount,
  successCount,
  errorCount,
  runningCount,
  queuedCount,
  overallPercent,
  failedBooks,
  totalSizeLabel,
  isRunningInBackground,
  startBatch,
  handleCancelBook,
  handleCancelAll,
  handlePickFiles,
  removeFile,
  clearFiles,
  closeModal,
  finishAndClose,
  setConcurrency,
  BOOK_PHASES,
  PHASE_LABELS,
  formatSize,
  phaseState
} = useBatchImport()

defineExpose({ isRunningInBackground })
</script>

<template>
  <n-modal :show="showModal" :mask-closable="false" @update:show="closeModal">
    <n-card
      style="width: min(600px, 92vw)"
      :bordered="false"
      role="dialog"
      aria-modal="true"
      closable
      @close="closeModal"
    >
      <template #header>
        <strong v-if="stage === 'picker'">批量导入参考小说</strong>
        <strong v-else-if="stage === 'running'">拆书进行中</strong>
        <strong v-else>拆书完成</strong>
      </template>

      <!-- ========= Stage: Picker ========= -->
      <div v-if="stage === 'picker'" class="batch-body">
        <div v-if="pickedFiles.length === 0" class="file-picker-empty" @click="handlePickFiles">
          <span class="big">📚</span>
          <span class="label">点击选择文件</span>
          <span class="hint">支持 .txt / .md / .docx，可一次选多本</span>
        </div>

        <template v-else>
          <div class="picker-toolbar">
            <span class="summary">已选 <strong>{{ pickedFiles.length }}</strong> 本，共 <strong>{{ totalSizeLabel }}</strong></span>
            <div class="picker-actions">
              <n-button size="small" secondary @click="handlePickFiles">+ 继续添加</n-button>
              <n-button size="small" secondary @click="clearFiles">清空</n-button>
            </div>
          </div>

          <div class="file-list">
            <div v-for="(file, index) in pickedFiles" :key="file.filePath" class="file-row">
              <span class="file-icon">📄</span>
              <span class="file-name">{{ file.fileName }}</span>
              <span class="file-size">{{ formatSize(file.size) }}</span>
              <button class="file-remove" type="button" @click="removeFile(index)">
                <X :size="14" />
              </button>
            </div>
          </div>

          <div class="concurrency-row">
            <label>并发数</label>
            <div class="seg" role="radiogroup">
              <button
                v-for="n in [1, 2, 3, 5]"
                :key="n"
                class="seg-btn"
                :class="{ active: concurrency === n }"
                type="button"
                @click="setConcurrency(n)"
              >{{ n }}</button>
            </div>
            <span class="concurrency-hint">同时拆几本</span>
          </div>
        </template>
      </div>

      <!-- ========= Stage: Running / Done ========= -->
      <div v-else class="batch-body">
        <div class="progress-summary" :class="{ 'is-done': stage === 'done' }">
          <div>
            <div class="summary-num">{{ completedCount }} / {{ bookList.length }}</div>
            <div class="summary-label">{{ stage === 'done' ? '全部处理完毕' : '已完成' }}</div>
          </div>
          <div class="stat-group">
            <div v-if="successCount > 0" class="stat">
              <div class="stat-num success">{{ successCount }}</div>
              <div class="stat-label">成功</div>
            </div>
            <div v-if="runningCount > 0" class="stat">
              <div class="stat-num primary">{{ runningCount }}</div>
              <div class="stat-label">运行中</div>
            </div>
            <div v-if="queuedCount > 0" class="stat">
              <div class="stat-num">{{ queuedCount }}</div>
              <div class="stat-label">排队</div>
            </div>
            <div v-if="errorCount > 0" class="stat">
              <div class="stat-num error">{{ errorCount }}</div>
              <div class="stat-label">失败</div>
            </div>
          </div>
        </div>

        <n-progress type="line" :percentage="overallPercent" :show-indicator="false" :height="6" />

        <div class="book-list">
          <div
            v-for="book in bookList"
            :key="book.bookId"
            class="book-card"
            :class="{
              'is-running': book.status === 'running',
              'is-done': book.status === 'success',
              'is-error': book.status === 'error' || book.status === 'canceled',
              'is-queued': book.status === 'queued'
            }"
          >
            <div class="book-head">
              <div class="book-title-block">
                <span class="book-status-dot" :class="`is-${book.status}`"></span>
                <span class="book-title">{{ book.fileName }}</span>
              </div>
              <div class="book-meta">
                <span class="book-percent" :class="`is-${book.status}`">
                  <template v-if="book.status === 'success'">完成</template>
                  <template v-else-if="book.status === 'error'">失败</template>
                  <template v-else-if="book.status === 'canceled'">已取消</template>
                  <template v-else-if="book.status === 'queued'">排队</template>
                  <template v-else>{{ book.percent }}%</template>
                </span>
                <button
                  v-if="book.status === 'running' || book.status === 'queued'"
                  class="book-cancel"
                  type="button"
                  @click="handleCancelBook(book.bookId)"
                >停止</button>
              </div>
            </div>

            <!-- Phase pills -->
            <div v-if="book.status === 'running'" class="book-phases">
              <template v-for="(p, i) in BOOK_PHASES.slice(0, -1)" :key="p">
                <span v-if="i > 0" class="phase-arrow">›</span>
                <span class="phase-pill" :class="`is-${phaseState(book, p)}`">{{ PHASE_LABELS[p] }}</span>
              </template>
            </div>

            <!-- Progress bar -->
            <div class="book-bar">
              <div
                class="book-bar-fill"
                :class="`is-${book.status}`"
                :style="{ width: `${book.percent}%` }"
              ></div>
            </div>

            <!-- Chunk grid (only during chunk-analysis) -->
            <div v-if="book.status === 'running' && book.phase === 'chunk-analysis' && book.chunkTotal > 0" class="chunk-progress">
              <div class="chunk-row">
                <span>分块进度</span>
                <span>{{ book.chunkIndex }} / {{ book.chunkTotal }}</span>
              </div>
              <div class="chunk-grid">
                <div
                  v-for="ci in book.chunkTotal"
                  :key="ci"
                  class="chunk-cell"
                  :class="{
                    'is-done': ci < book.chunkIndex,
                    'is-running': ci === book.chunkIndex
                  }"
                ></div>
              </div>
            </div>

            <!-- Detail line -->
            <div class="book-detail">
              <span class="book-detail-left">{{ book.message }}</span>
              <span v-if="book.elapsedLabel" class="book-detail-right">{{ book.elapsedLabel }}</span>
            </div>
          </div>
        </div>

        <!-- Error annotation (done stage) -->
        <div v-if="stage === 'done' && failedBooks.length > 0" class="annotation">
          <strong>{{ failedBooks.length }} 本未能完成：</strong>
          {{ failedBooks.map(b => b.fileName).join('、') }}
        </div>
      </div>

      <template #footer>
        <div class="batch-footer">
          <span v-if="stage === 'picker'" class="footer-hint"></span>
          <span v-else-if="stage === 'running'" class="footer-hint">关闭弹窗后任务会继续，可在右下角浮层查看</span>
          <span v-else class="footer-hint">已成功的 {{ successCount }} 本已自动归档到知识库</span>
          <div class="footer-actions">
            <template v-if="stage === 'picker'">
              <n-button round @click="closeModal">取消</n-button>
              <n-button type="primary" round :disabled="pickedFiles.length === 0" @click="startBatch">开始拆书</n-button>
            </template>
            <template v-else-if="stage === 'running'">
              <n-button round @click="handleCancelAll">全部停止</n-button>
              <n-button round @click="closeModal">最小化</n-button>
            </template>
            <template v-else>
              <n-button type="primary" round @click="finishAndClose">完成</n-button>
            </template>
          </div>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<style scoped>
.batch-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Picker ── */
.file-picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 20px;
  border: 2px dashed var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-weak);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.file-picker-empty:hover {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}
.file-picker-empty .big { font-size: 32px; }
.file-picker-empty .label { font-size: 13.5px; font-weight: 600; color: var(--arc-text-primary); }
.file-picker-empty .hint { font-size: 12px; color: var(--arc-text-hint); }

.picker-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.picker-toolbar .summary { font-size: 12.5px; color: var(--arc-text-secondary); }
.picker-toolbar .summary strong { color: var(--arc-text-primary); }
.picker-actions { display: flex; gap: 6px; }

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow-y: auto;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
}
.file-icon { font-size: 16px; flex-shrink: 0; }
.file-name { flex: 1; font-size: 13px; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: var(--arc-text-hint); font-size: 12px; flex-shrink: 0; }
.file-remove {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--arc-text-hint);
  cursor: pointer; padding: 2px; border-radius: 4px;
}
.file-remove:hover { background: color-mix(in srgb, var(--arc-danger) 12%, transparent); color: var(--arc-danger); }

.concurrency-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
}
.concurrency-row label { font-size: 13px; color: var(--arc-text-secondary); font-weight: 500; }
.concurrency-hint { font-size: 12px; color: var(--arc-text-hint); }
.seg {
  display: inline-flex;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  overflow: hidden;
}
.seg-btn {
  padding: 5px 11px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--arc-border); }
.seg-btn.active { background: var(--arc-primary); color: white; }

/* ── Progress ── */
.progress-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-primary);
}
.progress-summary.is-done {
  background: color-mix(in srgb, var(--arc-success) 8%, var(--arc-bg-surface));
  color: var(--arc-success);
}
.summary-num { font-size: 18px; font-weight: 700; }
.summary-label { font-size: 12.5px; opacity: 0.85; }
.stat-group { display: flex; gap: 16px; }
.stat { display: flex; flex-direction: column; align-items: flex-end; }
.stat-num { font-size: 16px; font-weight: 700; color: var(--arc-text-secondary); }
.stat-num.success { color: var(--arc-success); }
.stat-num.primary { color: var(--arc-primary); }
.stat-num.error { color: var(--arc-danger); }
.stat-label { font-size: 11px; color: var(--arc-text-hint); }

.book-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
}
.book-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  padding: 12px 14px;
  transition: border-color 0.2s;
}
.book-card.is-running { border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border)); }
.book-card.is-done { background: var(--arc-bg-weak); border-color: color-mix(in srgb, var(--arc-success) 30%, var(--arc-border)); }
.book-card.is-error {
  background: color-mix(in srgb, var(--arc-danger) 7%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-danger) 34%, var(--arc-border));
}
.book-card.is-queued { opacity: 0.6; }

.book-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.book-title-block { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.book-status-dot {
  width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0;
  background: var(--arc-text-hint);
}
.book-status-dot.is-running { background: var(--arc-primary); animation: pulse 1.5s ease-in-out infinite; }
.book-status-dot.is-success { background: var(--arc-success); }
.book-status-dot.is-error, .book-status-dot.is-canceled { background: var(--arc-danger); }
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-primary) 40%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--arc-primary) 0%, transparent); }
}
.book-title {
  font-size: 13.5px; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.book-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.book-percent {
  font-size: 12px; font-weight: 700; color: var(--arc-text-secondary); min-width: 32px; text-align: right;
}
.book-percent.is-success { color: var(--arc-success); }
.book-percent.is-error, .book-percent.is-canceled { color: var(--arc-danger); }
.book-cancel {
  border: none; background: transparent; color: var(--arc-text-hint);
  cursor: pointer; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-family: inherit;
}
.book-cancel:hover { background: color-mix(in srgb, var(--arc-danger) 12%, transparent); color: var(--arc-danger); }

.book-phases {
  display: flex; align-items: center; gap: 3px; margin-bottom: 6px; flex-wrap: wrap;
}
.phase-pill {
  display: inline-flex; padding: 2px 7px; border-radius: 999px;
  background: var(--arc-bg-weak); color: var(--arc-text-hint);
  font-size: 11px; font-weight: 500;
}
.phase-pill.is-active { background: color-mix(in srgb, var(--arc-primary) 12%, transparent); color: var(--arc-primary); }
.phase-pill.is-done { background: color-mix(in srgb, var(--arc-success) 10%, transparent); color: var(--arc-success); }
.phase-arrow { color: var(--arc-text-hint); font-size: 11px; }

.book-bar { height: 4px; border-radius: 999px; background: var(--arc-bg-weak); overflow: hidden; margin-bottom: 6px; }
.book-bar-fill { height: 100%; transition: width 0.3s; background: var(--arc-primary); }
.book-bar-fill.is-success { background: var(--arc-success); }
.book-bar-fill.is-error, .book-bar-fill.is-canceled { background: var(--arc-danger); }

.chunk-progress {
  padding: 8px 10px; background: var(--arc-bg-weak); border-radius: 6px;
  font-size: 11.5px; color: var(--arc-text-secondary); margin-bottom: 6px;
}
.chunk-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
.chunk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14px, 1fr)); gap: 3px; }
.chunk-cell { height: 6px; border-radius: 2px; background: var(--arc-border); }
.chunk-cell.is-done { background: var(--arc-success); }
.chunk-cell.is-running { background: var(--arc-primary); animation: chunkPulse 1.2s ease-in-out infinite; }
@keyframes chunkPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.book-detail { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; }
.book-detail-left { color: var(--arc-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.book-detail-right { color: var(--arc-text-hint); flex-shrink: 0; }

.annotation {
  padding: 10px 14px; border-radius: 8px;
  background: color-mix(in srgb, var(--arc-warning) 9%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--arc-warning) 34%, var(--arc-border));
  color: var(--arc-warning); font-size: 12.5px; line-height: 1.6;
}
.annotation strong { color: inherit; }

/* ── Footer ── */
.batch-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.footer-hint { color: var(--arc-text-hint); font-size: 12px; }
.footer-actions { display: flex; gap: 8px; }
</style>
