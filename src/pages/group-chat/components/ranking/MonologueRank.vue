<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MonologueAnalysis } from '@/types/analysis'
import { SectionCard, EmptyState, LoadingState } from '@/components/UI'
import { formatDateTime, getRankBadgeClass } from '@/utils'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<MonologueAnalysis | null>(null)
const isLoading = ref(false)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getMonologueAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载自言自语分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

function getComboLabel(maxCombo: number): { text: string; color: string } {
  if (maxCombo >= 10) return { text: '无人区广播', color: 'text-red-600 dark:text-red-400' }
  if (maxCombo >= 5) return { text: '小作文达人', color: 'text-yellow-600 dark:text-yellow-400' }
  return { text: '加特林模式', color: 'text-green-600 dark:text-green-400' }
}

const maxTotalStreaks = computed(() => {
  if (!analysis.value || analysis.value.rank.length === 0) return 1
  return analysis.value.rank[0].totalStreaks
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <SectionCard title="🎤 自言自语榜" description="连续发言 ≥3 条（间隔 ≤5 分钟）统计">
    <LoadingState v-if="isLoading" text="正在统计自言自语数据..." />

    <template v-else-if="analysis && analysis.rank.length > 0">
      <!-- 最高纪录卡片 -->
      <div
        v-if="analysis.maxComboRecord"
        class="mx-5 mt-4 rounded-lg bg-linear-to-r from-amber-50 to-orange-50 p-4 dark:from-amber-900/20 dark:to-orange-900/20"
      >
        <div class="flex items-center gap-2">
          <span class="text-2xl">🏆</span>
          <span class="font-semibold text-gray-900 dark:text-white">历史最高连击纪录</span>
        </div>
        <div class="mt-2 flex items-baseline gap-2 whitespace-nowrap">
          <span class="text-lg font-bold text-amber-600 dark:text-amber-400">
            {{ analysis.maxComboRecord.memberName }}
          </span>
          <span class="text-sm text-gray-500">在</span>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ formatDateTime(analysis.maxComboRecord.startTs) }}
          </span>
          <span class="text-sm text-gray-500">达成了</span>
          <span class="text-2xl font-bold text-red-600 dark:text-red-400">
            {{ analysis.maxComboRecord.comboLength }} 连击！
          </span>
        </div>
      </div>

      <!-- 排行榜 -->
      <div class="divide-y divide-gray-100 dark:divide-gray-800">
        <div
          v-for="(member, index) in analysis.rank.slice(0, 10)"
          :key="member.memberId"
          class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
          <!-- 排名 -->
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            :class="getRankBadgeClass(index)"
          >
            {{ index + 1 }}
          </div>

          <!-- 名字 + 标签 -->
          <div class="w-32 shrink-0">
            <p class="truncate font-medium text-gray-900 dark:text-white">
              {{ member.name }}
            </p>
            <p class="text-xs" :class="getComboLabel(member.maxCombo).color">
              {{ getComboLabel(member.maxCombo).text }}
            </p>
          </div>

          <!-- 三色能量条 -->
          <div class="flex flex-1 items-center">
            <div class="h-4 w-full rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                class="flex h-full overflow-hidden rounded-full"
                :style="{ width: `${(member.totalStreaks / maxTotalStreaks) * 100}%` }"
              >
                <div
                  v-if="member.lowStreak > 0"
                  class="h-full bg-green-500"
                  :style="{ width: `${(member.lowStreak / member.totalStreaks) * 100}%` }"
                  :title="`3-4句: ${member.lowStreak}次`"
                />
                <div
                  v-if="member.midStreak > 0"
                  class="h-full bg-yellow-500"
                  :style="{ width: `${(member.midStreak / member.totalStreaks) * 100}%` }"
                  :title="`5-9句: ${member.midStreak}次`"
                />
                <div
                  v-if="member.highStreak > 0"
                  class="h-full bg-red-500"
                  :style="{ width: `${(member.highStreak / member.totalStreaks) * 100}%` }"
                  :title="`10+句: ${member.highStreak}次`"
                />
              </div>
            </div>
          </div>

          <!-- 统计数据 -->
          <div class="shrink-0 text-right">
            <div class="text-lg font-bold text-gray-900 dark:text-white">{{ member.totalStreaks }} 次</div>
            <div class="flex items-center justify-end gap-1 text-xs text-gray-500">
              <span>Max</span>
              <span class="font-semibold text-pink-600 dark:text-pink-400">{{ member.maxCombo }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 图例 -->
      <div class="flex items-center justify-center gap-6 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-3 rounded-full bg-green-500" />
          <span class="text-xs text-gray-500">3-4句</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-3 rounded-full bg-yellow-500" />
          <span class="text-xs text-gray-500">5-9句</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-3 rounded-full bg-red-500" />
          <span class="text-xs text-gray-500">10+句</span>
        </div>
      </div>
    </template>

    <EmptyState v-else text="暂无自言自语数据" />
  </SectionCard>
</template>
