<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CheckInAnalysis } from '@/types/analysis'
import { RankListPro, ListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { SectionCard, LoadingState, EmptyState } from '@/components/UI'
import { getRankBadgeClass } from '@/utils'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<CheckInAnalysis | null>(null)
const isLoading = ref(false)

async function loadAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getCheckInAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载打卡分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 忠臣榜数据转换
function getLoyaltyRankData(): RankItem[] {
  if (!analysis.value) return []
  return analysis.value.loyaltyRank.map((item) => ({
    id: item.memberId.toString(),
    name: item.name,
    value: item.totalDays,
    percentage: item.percentage,
  }))
}

// 格式化日期区间
function formatDateRange(start: string, end: string): string {
  return `${start} ~ ${end}`
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="space-y-6">
    <LoadingState v-if="isLoading" text="正在分析打卡数据..." />

    <template v-else-if="analysis">
      <!-- 火花榜：连续发言天数 -->
      <div id="streak-rank" class="scroll-mt-24">
        <ListPro
          v-if="analysis.streakRank.length > 0"
          :items="analysis.streakRank"
          title="🔥 火花榜"
          description="最长连续发言天数排名"
          :topN="10"
          countTemplate="共 {count} 位成员"
        >
          <template #item="{ item, index }">
            <div class="flex items-center gap-3">
              <!-- 排名 -->
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                :class="getRankBadgeClass(index)"
              >
                {{ index + 1 }}
              </div>

              <!-- 名字 -->
              <div class="w-28 shrink-0">
                <p class="truncate font-medium text-gray-900 dark:text-white">
                  {{ item.name }}
                </p>
              </div>

              <!-- 连续天数 -->
              <div class="flex flex-1 items-center gap-3">
                <div class="text-lg font-bold text-orange-600 dark:text-orange-400">{{ item.maxStreak }} 天</div>
                <div class="text-xs text-gray-500">
                  {{ formatDateRange(item.maxStreakStart, item.maxStreakEnd) }}
                </div>
              </div>

              <!-- 当前连续 -->
              <div v-if="item.currentStreak > 0" class="shrink-0">
                <span
                  class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap"
                >
                  当前连续 {{ item.currentStreak }} 天 🔥
                </span>
              </div>
            </div>
          </template>
        </ListPro>
      </div>

      <!-- 忠臣榜：累计发言天数 -->
      <div id="loyalty-rank" class="scroll-mt-24">
        <RankListPro
          v-if="analysis.loyaltyRank.length > 0"
          :members="getLoyaltyRankData()"
          title="💎 忠臣榜"
          :description="`累计发言天数排名（群聊共 ${analysis.totalDays} 天）`"
          unit="天"
        />
      </div>
    </template>

    <SectionCard v-else title="🎯 打卡榜">
      <EmptyState text="暂无打卡数据" />
    </SectionCard>
  </div>
</template>
