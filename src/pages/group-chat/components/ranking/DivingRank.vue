<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DivingAnalysis } from '@/types/analysis'
import { ListPro } from '@/components/charts'
import { LoadingState } from '@/components/UI'
import { formatFullDateTime, formatDaysSince, getRankBadgeClass } from '@/utils'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<DivingAnalysis | null>(null)
const isLoading = ref(false)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getDivingAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载潜水分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <LoadingState v-if="isLoading" text="正在统计潜水数据..." />
  <ListPro
    v-else-if="analysis && analysis.rank.length > 0"
    :items="analysis.rank"
    title="🤿 潜水榜"
    description="按最后发言时间排序，最久没发言的在前面"
    countTemplate="共 {count} 位潜水员"
  >
    <template #item="{ item: member, index }">
      <div class="flex items-center gap-3">
        <!-- 排名 -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          :class="getRankBadgeClass(index)"
        >
          {{ index + 1 }}
        </div>

        <!-- 名字 -->
        <div class="w-32 shrink-0">
          <p class="truncate font-medium text-gray-900 dark:text-white">
            {{ member.name }}
          </p>
        </div>

        <!-- 最后发言时间 -->
        <div class="flex flex-1 items-center gap-2">
          <span class="text-sm text-gray-600 dark:text-gray-400">
            {{ formatFullDateTime(member.lastMessageTs) }}
          </span>
        </div>

        <!-- 距今天数 -->
        <div class="shrink-0 text-right">
          <span
            class="text-sm font-medium"
            :class="
              member.daysSinceLastMessage > 30
                ? 'text-red-600 dark:text-red-400'
                : member.daysSinceLastMessage > 7
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-gray-600 dark:text-gray-400'
            "
          >
            {{ formatDaysSince(member.daysSinceLastMessage) }}
          </span>
        </div>
      </div>
    </template>
  </ListPro>
</template>
